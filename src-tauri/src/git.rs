//! Read-only git access through libgit2 (`git2`), in-process: no `git` binary is needed, which the
//! Mac App Store sandbox requires (/usr/bin/git there is an xcrun shim that refuses to run
//! sandboxed). Only the operations in `GitOp` exist and the only user-supplied value (a commit
//! hash) is validated. Each operation reproduces the text output of the git command it replaces,
//! because the frontend parsers (`src/domain/git/parse.ts`) consume that format.

use git2::{
    Delta, Diff, DiffOptions, ErrorCode, ObjectType, Oid, Patch, Repository, RepositoryOpenFlags,
    StatusOptions, StatusShow, Time,
};
use serde::Deserialize;
use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use tauri::State;

use crate::projects::{allowed_root, Roots};

/// Diff output is capped so a huge change cannot freeze the UI; the frontend reports truncation.
const MAX_OUTPUT_BYTES: usize = 4 * 1024 * 1024;
const TRUNCATED_MARKER: &[u8] = b"\n\x00TRUNCATED\x00";

#[derive(Deserialize, Debug)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum GitOp {
    /// `git status --porcelain=v1 -b -z`
    Status,
    /// Recent commits, one record per commit.
    Log { limit: u32 },
    /// Uncommitted changes (staged and unstaged) against HEAD.
    DiffWorking { context: u32 },
    /// The changes introduced by one commit.
    DiffCommit { hash: String, context: u32 },
}

fn err(e: git2::Error) -> String {
    e.message().to_string()
}

fn open(root: &Path) -> Result<Repository, String> {
    // Like the git CLI, honour GIT_CEILING_DIRECTORIES when searching upwards for the repository.
    let ceilings: Vec<_> = std::env::var_os("GIT_CEILING_DIRECTORIES")
        .map(|v| std::env::split_paths(&v).collect())
        .unwrap_or_default();
    Repository::open_ext(root, RepositoryOpenFlags::empty(), ceilings).map_err(|e| {
        if e.code() == ErrorCode::NotFound {
            "not a git repository".to_string()
        } else {
            err(e)
        }
    })
}

pub fn run(root: &Path, op: &GitOp) -> Result<String, String> {
    // Validate before touching the filesystem, as the CLI version did.
    if let GitOp::DiffCommit { hash, .. } = op {
        if !(4..=40).contains(&hash.len()) || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(format!("invalid commit hash: {hash}"));
        }
    }
    let repo = open(root)?;
    if repo.is_bare() {
        return Err("this operation must be run in a work tree".into());
    }
    let ctx = |c: &u32| (*c).clamp(0, 30);
    let mut out = match op {
        GitOp::Status => status(&repo)?,
        GitOp::Log { limit } => log(&repo, (*limit).clamp(1, 200) as usize)?,
        GitOp::DiffWorking { context } => diff_working(&repo, ctx(context))?,
        GitOp::DiffCommit { hash, context } => diff_commit(&repo, hash, ctx(context))?,
    };
    if out.len() > MAX_OUTPUT_BYTES {
        out.truncate(MAX_OUTPUT_BYTES);
        out.extend_from_slice(TRUNCATED_MARKER);
    }
    Ok(String::from_utf8_lossy(&out).into_owned())
}

// ---------------------------------------------------------------------------------------------
// status: `git status --porcelain=v1 -b -z`

/// The ref name as `git` shortens it for display (`refs/remotes/origin/main` -> `origin/main`).
fn short_ref(name: &str) -> &str {
    ["refs/heads/", "refs/remotes/", "refs/tags/", "refs/"]
        .iter()
        .find_map(|p| name.strip_prefix(p))
        .unwrap_or(name)
}

fn branch_header(repo: &Repository) -> Result<String, String> {
    let head = match repo.head() {
        Ok(h) => h,
        Err(e) if e.code() == ErrorCode::UnbornBranch => {
            let target = repo
                .find_reference("HEAD")
                .ok()
                .and_then(|r| r.symbolic_target().map(str::to_string))
                .unwrap_or_default();
            return Ok(format!("## No commits yet on {}", short_ref(&target)));
        }
        Err(e) => return Err(err(e)),
    };
    if !head.is_branch() {
        return Ok("## HEAD (no branch)".into());
    }
    let refname = head.name().unwrap_or_default().to_string();
    let mut line = format!("## {}", short_ref(&refname));
    // No upstream configured (or one that cannot be resolved from config): just the branch name.
    let Ok(upstream) = repo.branch_upstream_name(&refname) else {
        return Ok(line);
    };
    let Some(upstream) = upstream.as_str().map(str::to_string) else {
        return Ok(line);
    };
    line.push_str("...");
    line.push_str(short_ref(&upstream));
    let upstream_oid = repo
        .find_reference(&upstream)
        .ok()
        .and_then(|r| r.resolve().ok())
        .and_then(|r| r.target());
    match (head.target(), upstream_oid) {
        (_, None) => line.push_str(" [gone]"),
        (Some(local), Some(up)) => {
            let (ahead, behind) = repo.graph_ahead_behind(local, up).map_err(err)?;
            match (ahead, behind) {
                (0, 0) => {}
                (a, 0) => line.push_str(&format!(" [ahead {a}]")),
                (0, b) => line.push_str(&format!(" [behind {b}]")),
                (a, b) => line.push_str(&format!(" [ahead {a}, behind {b}]")),
            }
        }
        (None, Some(_)) => {}
    }
    Ok(line)
}

/// The two-letter code git uses for an unmerged path, from which conflict stages exist.
fn conflict_code(ancestor: bool, ours: bool, theirs: bool) -> &'static [u8; 2] {
    match (ancestor, ours, theirs) {
        (true, false, false) => b"DD",
        (false, true, false) => b"AU",
        (true, true, false) => b"UD",
        (false, false, true) => b"UA",
        (true, false, true) => b"DU",
        (false, true, true) => b"AA",
        _ => b"UU",
    }
}

fn status(repo: &Repository) -> Result<Vec<u8>, String> {
    let mut out = branch_header(repo)?.into_bytes();
    out.push(0);

    // Renames are detected below with git's own algorithm (libgit2's similarity metric differs).
    let mut opts = StatusOptions::new();
    opts.show(StatusShow::IndexAndWorkdir)
        .include_untracked(true)
        .recurse_untracked_dirs(false)
        .include_ignored(false)
        .include_unmodified(false)
        .exclude_submodules(false)
        .renames_head_to_index(false)
        .renames_index_to_workdir(false);
    let statuses = repo.statuses(Some(&mut opts)).map_err(err)?;

    // Unmerged paths: the code depends on which conflict stages are present in the index.
    let mut conflicts: Vec<(Vec<u8>, &'static [u8; 2])> = Vec::new();
    if statuses.iter().any(|e| e.status().is_conflicted()) {
        let index = repo.index().map_err(err)?;
        for c in index.conflicts().map_err(err)? {
            let c = c.map_err(err)?;
            let path = [&c.our, &c.their, &c.ancestor]
                .iter()
                .find_map(|e| e.as_ref().map(|e| e.path.clone()))
                .unwrap_or_default();
            let code = conflict_code(c.ancestor.is_some(), c.our.is_some(), c.their.is_some());
            conflicts.push((path, code));
        }
    }

    struct Change {
        path: Vec<u8>,
        code: [u8; 2],
        orig: Option<Vec<u8>>,
    }
    // git prints tracked changes sorted by (new) path, then untracked paths, sorted.
    let mut changes: Vec<Change> = Vec::new();
    let mut untracked: Vec<Vec<u8>> = Vec::new();
    // Rename candidates between HEAD and the index: (change index, side).
    let mut sides = Sides::new(repo);
    let (mut srcs, mut dsts) = (Vec::new(), Vec::new());
    for e in statuses.iter() {
        let s = e.status();
        let path = e.path_bytes().to_vec();
        if s.is_wt_new() {
            // Also covers a path removed from the index but still on disk ("D " plus "??").
            untracked.push(path.clone());
        }
        if s.is_conflicted() {
            let code = conflicts
                .iter()
                .find(|(p, _)| *p == path)
                .map(|(_, c)| **c)
                .unwrap_or(*b"UU");
            changes.push(Change {
                path,
                code,
                orig: None,
            });
            continue;
        }
        let x = if s.is_index_new() {
            b'A'
        } else if s.is_index_modified() {
            b'M'
        } else if s.is_index_deleted() {
            b'D'
        } else if s.is_index_typechange() {
            b'T'
        } else {
            b' '
        };
        let y = if s.is_wt_modified() {
            b'M'
        } else if s.is_wt_deleted() {
            b'D'
        } else if s.is_wt_typechange() {
            b'T'
        } else {
            b' '
        };
        if x == b' ' && y == b' ' {
            continue; // untracked (handled above), ignored or unreadable entries
        }
        if let Some(d) = e.head_to_index() {
            if x == b'A' {
                let f = d.new_file();
                dsts.push((
                    changes.len(),
                    sides.push(&path, f.mode().into(), f.id(), None),
                ));
            } else if x == b'D' {
                let f = d.old_file();
                srcs.push((
                    changes.len(),
                    sides.push(&path, f.mode().into(), f.id(), None),
                ));
            }
        }
        changes.push(Change {
            path,
            code: [x, y],
            orig: None,
        });
    }

    let src_ids: Vec<usize> = srcs.iter().map(|s| s.1).collect();
    let dst_ids: Vec<usize> = dsts.iter().map(|d| d.1).collect();
    let mut drop = vec![false; changes.len()];
    for (di, si, _) in find_renames(&mut sides, &src_ids, &dst_ids) {
        let (src_change, dst_change) = (srcs[si].0, dsts[di].0);
        drop[src_change] = true;
        let orig = changes[src_change].path.clone();
        let c = &mut changes[dst_change];
        c.code[0] = b'R';
        c.orig = Some(orig);
    }
    let mut changes: Vec<Change> = changes
        .into_iter()
        .zip(drop)
        .filter_map(|(c, d)| (!d).then_some(c))
        .collect();
    changes.sort_by(|a, b| a.path.cmp(&b.path));
    untracked.sort();

    for c in changes {
        out.extend_from_slice(&c.code);
        out.push(b' ');
        out.extend_from_slice(&c.path);
        out.push(0);
        if let Some(orig) = c.orig {
            out.extend_from_slice(&orig);
            out.push(0);
        }
    }
    for path in untracked {
        out.extend_from_slice(b"?? ");
        out.extend_from_slice(&path);
        out.push(0);
    }
    Ok(out)
}

// ---------------------------------------------------------------------------------------------
// log: `git log -n<limit> --format=%H%x1f%an%x1f%aI%x1f%s%x1e`

/// Days since 1970-01-01 to a proleptic Gregorian (year, month, day). (H. Hinnant's algorithm.)
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

/// `%aI`: strict ISO 8601 in the author's own timezone, e.g. `2026-10-01T10:00:00+03:00`.
fn iso_strict(t: Time) -> String {
    let off = i64::from(t.offset_minutes());
    let local = t.seconds() + off * 60;
    let (y, mo, d) = civil_from_days(local.div_euclid(86_400));
    let secs = local.rem_euclid(86_400);
    let abs = off.abs();
    format!(
        "{y:04}-{mo:02}-{d:02}T{:02}:{:02}:{:02}{}{:02}:{:02}",
        secs / 3600,
        secs / 60 % 60,
        secs % 60,
        t.sign(),
        abs / 60,
        abs % 60
    )
}

/// `%s`: the first paragraph of the message, each line right-trimmed, joined with spaces.
fn subject(msg: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut started = false;
    for line in msg.split(|&b| b == b'\n') {
        let end = line
            .iter()
            .rposition(|b| !b.is_ascii_whitespace())
            .map_or(0, |i| i + 1);
        let line = &line[..end];
        if line.is_empty() {
            if started {
                break;
            }
            continue; // leading blank lines are skipped
        }
        if started {
            out.push(b' ');
        }
        out.extend_from_slice(line);
        started = true;
    }
    out
}

fn log(repo: &Repository, limit: usize) -> Result<Vec<u8>, String> {
    let head = match repo.head() {
        Ok(h) => h,
        Err(e) if e.code() == ErrorCode::UnbornBranch => {
            let name = repo
                .find_reference("HEAD")
                .ok()
                .and_then(|r| r.symbolic_target().map(|t| short_ref(t).to_string()))
                .unwrap_or_default();
            return Err(format!(
                "your current branch '{name}' does not have any commits yet"
            ));
        }
        Err(e) => return Err(err(e)),
    };
    // git log's default order: repeatedly show the queued commit with the newest committer
    // date (ties in queueing order), then queue its unseen parents. libgit2's time sort
    // differs from this when dates are not monotonic along the history.
    let start = head.peel_to_commit().map_err(err)?;
    let mut queue = BinaryHeap::new();
    let mut seen = HashSet::new();
    let mut queued = 0u64;
    seen.insert(start.id());
    queue.push((start.time().seconds(), Reverse(queued), start.id()));
    let mut out = Vec::new();
    let mut shown = 0;
    while let Some((_, _, oid)) = queue.pop() {
        if shown == limit {
            break;
        }
        shown += 1;
        let commit = repo.find_commit(oid).map_err(err)?;
        for parent in commit.parents() {
            if seen.insert(parent.id()) {
                queued += 1;
                queue.push((parent.time().seconds(), Reverse(queued), parent.id()));
            }
        }
        let author = commit.author();
        out.extend_from_slice(commit.id().to_string().as_bytes());
        out.push(0x1f);
        out.extend_from_slice(author.name_bytes());
        out.push(0x1f);
        out.extend_from_slice(iso_strict(author.when()).as_bytes());
        out.push(0x1f);
        out.extend_from_slice(&subject(commit.message_raw_bytes()));
        out.extend_from_slice(b"\x1e\n");
    }
    Ok(out)
}

// ---------------------------------------------------------------------------------------------
// Rename detection, ported from git's diffcore-rename.c / diffcore-delta.c so that the same
// pairs (and the same "similarity index") come out as with the CLI. libgit2's own
// `find_similar` uses a different similarity metric and disagrees on small or heavily edited
// files.

/// git's MAX_SCORE; similarity scores are fractions of it.
const MAX_SCORE: u64 = 60_000;
/// `--find-renames` without a value: 50%.
const MIN_SCORE: u64 = MAX_SCORE / 2;
/// git's default diff.renameLimit: above limit^2 source/destination pairs, only exact renames.
const RENAME_LIMIT: usize = 1000;
const CANDIDATES_PER_DST: usize = 4;
const HASHBASE: u32 = 107_927;

/// One side of a potential rename: a deleted (source) or added (destination) file.
struct Side {
    path: Vec<u8>,
    mode: u32,
    oid: Oid,
    /// Where to read the content when the blob is not in the object database (worktree files).
    file: Option<PathBuf>,
    size: Option<u64>,
    data: Option<Vec<u8>>,
    spans: Option<Vec<(u32, u64)>>,
}

/// Rename candidates with lazily loaded content.
struct Sides<'r> {
    repo: &'r Repository,
    all: Vec<Side>,
}

fn is_regular(mode: u32) -> bool {
    mode & 0o170000 == 0o100000
}

/// git's `buffer_is_binary`: a NUL byte in the first 8000 bytes.
fn is_binary(data: &[u8]) -> bool {
    data[..data.len().min(8000)].contains(&0)
}

impl<'r> Sides<'r> {
    fn new(repo: &'r Repository) -> Self {
        Sides {
            repo,
            all: Vec::new(),
        }
    }

    fn push(&mut self, path: &[u8], mode: u32, oid: Oid, file: Option<PathBuf>) -> usize {
        self.all.push(Side {
            path: path.to_vec(),
            mode,
            oid,
            file,
            size: None,
            data: None,
            spans: None,
        });
        self.all.len() - 1
    }

    fn size(&mut self, i: usize) -> u64 {
        if let Some(s) = self.all[i].size {
            return s;
        }
        let side = &self.all[i];
        let s = if let Some(d) = &side.data {
            d.len() as u64
        } else if let Some(s) = self
            .repo
            .odb()
            .ok()
            .and_then(|o| o.read_header(side.oid).ok())
            .map(|(s, _)| s as u64)
        {
            s
        } else {
            side.file
                .as_ref()
                .and_then(|f| std::fs::metadata(f).ok())
                .map_or(0, |m| m.len())
        };
        self.all[i].size = Some(s);
        s
    }

    fn data(&mut self, i: usize) -> &[u8] {
        if self.all[i].data.is_none() {
            let side = &self.all[i];
            let data = match self.repo.find_blob(side.oid) {
                Ok(b) => b.content().to_vec(),
                Err(_) => side
                    .file
                    .as_ref()
                    .and_then(|f| std::fs::read(f).ok())
                    .unwrap_or_default(),
            };
            self.all[i].size = Some(data.len() as u64);
            self.all[i].data = Some(data);
        }
        self.all[i].data.as_deref().unwrap_or_default()
    }

    /// diffcore-delta's `hash_chars`: byte counts per hash of line-ish chunks (split after
    /// '\n' or 64 bytes; CR of CRLF ignored in text), sorted by hash.
    fn spans(&mut self, i: usize) -> &[(u32, u64)] {
        if self.all[i].spans.is_none() {
            let data = self.data(i);
            let text = !is_binary(data);
            let mut map: HashMap<u32, u64> = HashMap::new();
            let (mut a1, mut a2, mut n) = (0u32, 0u32, 0u64);
            let mut k = 0;
            while k < data.len() {
                let c = data[k];
                k += 1;
                if text && c == b'\r' && k < data.len() && data[k] == b'\n' {
                    continue;
                }
                let old1 = a1;
                a1 = (a1 << 7) ^ (a2 >> 25);
                a2 = (a2 << 7) ^ (old1 >> 25);
                a1 = a1.wrapping_add(u32::from(c));
                n += 1;
                if n < 64 && c != b'\n' {
                    continue;
                }
                *map.entry(a1.wrapping_add(a2.wrapping_mul(0x61)) % HASHBASE)
                    .or_default() += n;
                n = 0;
                a1 = 0;
                a2 = 0;
            }
            if n > 0 {
                *map.entry(a1.wrapping_add(a2.wrapping_mul(0x61)) % HASHBASE)
                    .or_default() += n;
            }
            let mut spans: Vec<(u32, u64)> = map.into_iter().collect();
            spans.sort_unstable();
            self.all[i].spans = Some(spans);
        }
        self.all[i].spans.as_deref().unwrap_or_default()
    }

    /// diffcore-rename's `estimate_similarity`.
    fn similarity(&mut self, src: usize, dst: usize, min_score: u64) -> u64 {
        if !is_regular(self.all[src].mode) || !is_regular(self.all[dst].mode) {
            return 0;
        }
        let (ss, ds) = (self.size(src), self.size(dst));
        let (max, base) = (ss.max(ds), ss.min(ds));
        if max * (MAX_SCORE - min_score) < (max - base) * MAX_SCORE {
            return 0;
        }
        let s = self.spans(src).to_vec();
        let d = self.spans(dst);
        // Bytes of the destination that also occur in the source (diffcore_count_changes).
        let (mut copied, mut j) = (0u64, 0usize);
        for &(h, dc) in d {
            while j < s.len() && s[j].0 < h {
                j += 1;
            }
            let sc = if j < s.len() && s[j].0 == h {
                s[j].1
            } else {
                0
            };
            copied += sc.min(dc);
        }
        let (ss, ds) = (self.size(src), self.size(dst));
        let max = ss.max(ds);
        if ds == 0 || max == 0 {
            return 0;
        }
        copied * MAX_SCORE / max
    }
}

/// diffcore-rename's `basename_same`.
fn basename_same(a: &[u8], b: &[u8]) -> bool {
    let (mut i, mut j) = (a.len(), b.len());
    while i > 0 && j > 0 {
        i -= 1;
        j -= 1;
        if a[i] != b[j] {
            return false;
        }
        if a[i] == b'/' {
            return true;
        }
    }
    (i == 0 || a[i - 1] == b'/') && (j == 0 || b[j - 1] == b'/')
}

fn basename(p: &[u8]) -> &[u8] {
    p.rsplit(|&c| c == b'/').next().unwrap_or(p)
}

#[derive(Clone, Copy)]
struct Score {
    dst: Option<usize>,
    src: usize,
    score: u64,
    name: bool,
}

/// diffcore-rename's `score_compare`: Less means `a` is the better candidate.
fn score_cmp(a: &Score, b: &Score) -> std::cmp::Ordering {
    use std::cmp::Ordering::*;
    match (a.dst, b.dst) {
        (None, None) => Equal,
        (None, Some(_)) => Greater,
        (Some(_), None) => Less,
        _ if a.score == b.score => b.name.cmp(&a.name),
        _ => b.score.cmp(&a.score),
    }
}

/// Pairs deleted files (`srcs`) with added files (`dsts`) the way `git diff -M` does.
/// Returns (position in `dsts`, position in `srcs`, score).
fn find_renames(sides: &mut Sides, srcs: &[usize], dsts: &[usize]) -> Vec<(usize, usize, u64)> {
    let mut pairs = Vec::new();
    if srcs.is_empty() || dsts.is_empty() {
        return pairs;
    }
    let mut src_used = vec![false; srcs.len()];
    let mut dst_done = vec![false; dsts.len()];

    // 1. Exact renames (same blob), preferring an unused source with the same basename.
    for (di, &d) in dsts.iter().enumerate() {
        let mut best: Option<(usize, u32)> = None;
        for (si, &s) in srcs.iter().enumerate() {
            let (src, dst) = (&sides.all[s], &sides.all[d]);
            if src_used[si] || src.oid != dst.oid {
                continue;
            }
            if (!is_regular(src.mode) || !is_regular(dst.mode)) && src.mode != dst.mode {
                continue;
            }
            let score = 1 + u32::from(basename_same(&src.path, &dst.path));
            if best.is_none_or(|(_, b)| score > b) {
                best = Some((si, score));
                if score == 2 {
                    break;
                }
            }
        }
        if let Some((si, _)) = best {
            src_used[si] = true;
            dst_done[di] = true;
            pairs.push((di, si, MAX_SCORE));
        }
    }

    // 2. Files whose basename is unique among the remaining sources and destinations are
    //    compared with each other first, with a higher bar (75%).
    let min_basename = MIN_SCORE + (MAX_SCORE - MIN_SCORE) / 2;
    let unique = |paths: Vec<(usize, &[u8])>| {
        let mut m: HashMap<Vec<u8>, Option<usize>> = Default::default();
        for (i, p) in paths {
            m.entry(basename(p).to_vec())
                .and_modify(|v| *v = None)
                .or_insert(Some(i));
        }
        m
    };
    let src_bases = unique(
        (0..srcs.len())
            .filter(|&i| !src_used[i])
            .map(|i| (i, sides.all[srcs[i]].path.as_slice()))
            .collect(),
    );
    let dst_bases = unique(
        (0..dsts.len())
            .filter(|&i| !dst_done[i])
            .map(|i| (i, sides.all[dsts[i]].path.as_slice()))
            .collect(),
    );
    for di in 0..dsts.len() {
        if dst_done[di] {
            continue;
        }
        let base = basename(&sides.all[dsts[di]].path).to_vec();
        let Some(&Some(si)) = src_bases.get(&base) else {
            continue;
        };
        if src_used[si] || !matches!(dst_bases.get(&base), Some(Some(_))) {
            continue;
        }
        let score = sides.similarity(srcs[si], dsts[di], min_basename);
        if score >= min_basename {
            src_used[si] = true;
            dst_done[di] = true;
            pairs.push((di, si, score));
        }
    }

    // 3. Everything else: the best few sources per destination, then greedily by score.
    let rem_src: Vec<usize> = (0..srcs.len()).filter(|&i| !src_used[i]).collect();
    let rem_dst: Vec<usize> = (0..dsts.len()).filter(|&i| !dst_done[i]).collect();
    if rem_src.is_empty()
        || rem_dst.is_empty()
        || rem_src.len() * rem_dst.len() > RENAME_LIMIT * RENAME_LIMIT
    {
        return pairs;
    }
    let empty = Score {
        dst: None,
        src: 0,
        score: 0,
        name: false,
    };
    let mut mx: Vec<Score> = Vec::with_capacity(rem_dst.len() * CANDIDATES_PER_DST);
    for &di in &rem_dst {
        let mut m = [empty; CANDIDATES_PER_DST];
        for &si in &rem_src {
            let this = Score {
                dst: Some(di),
                src: si,
                score: sides.similarity(srcs[si], dsts[di], MIN_SCORE),
                name: basename_same(&sides.all[srcs[si]].path, &sides.all[dsts[di]].path),
            };
            let mut worst = 0;
            for k in 1..CANDIDATES_PER_DST {
                if score_cmp(&m[k], &m[worst]).is_gt() {
                    worst = k;
                }
            }
            if score_cmp(&m[worst], &this).is_gt() {
                m[worst] = this;
            }
        }
        mx.extend_from_slice(&m);
    }
    mx.sort_by(score_cmp); // stable, like git's STABLE_QSORT
    for c in mx {
        let Some(di) = c.dst else { break };
        if c.score < MIN_SCORE {
            break;
        }
        if dst_done[di] || src_used[c.src] {
            continue;
        }
        dst_done[di] = true;
        src_used[c.src] = true;
        pairs.push((di, c.src, c.score));
    }
    pairs
}

// ---------------------------------------------------------------------------------------------
// diffs: `git diff -U<n> --no-color --no-ext-diff --find-renames HEAD` and
//        `git show --format= -U<n> --no-color --no-ext-diff --find-renames <hash>`

fn diff_options(context: u32) -> DiffOptions {
    let mut o = DiffOptions::new();
    o.context_lines(context)
        .interhunk_lines(0)
        .indent_heuristic(true) // git's default since 2.14 (diff.indentHeuristic)
        .ignore_submodules(false);
    o
}

/// git's abbreviated object names (`find_unique_abbrev`): core.abbrev, or by default a length
/// derived from the number of packed objects (at least 7), extended until unambiguous.
struct Abbrev<'r> {
    odb: Option<git2::Odb<'r>>,
    min: usize,
}

impl<'r> Abbrev<'r> {
    fn new(repo: &'r Repository) -> Self {
        let configured = repo.config().ok().and_then(|c| {
            c.get_i32("core.abbrev")
                .ok()
                .map(|n| n.clamp(4, 40) as usize)
                .or_else(|| match c.get_string("core.abbrev").ok()?.as_str() {
                    "no" | "false" => Some(40),
                    _ => None,
                })
        });
        Abbrev {
            odb: repo.odb().ok(),
            min: configured.unwrap_or_else(|| auto_abbrev(repo)),
        }
    }

    fn hex(&self, oid: Oid) -> String {
        let full = oid.to_string();
        let Some(odb) = self.odb.as_ref().filter(|_| !oid.is_zero()) else {
            return full[..self.min].to_string();
        };
        for len in self.min..full.len() {
            let Ok(prefix) = Oid::from_str(&full[..len]) else {
                break;
            };
            match odb.exists_prefix(prefix, len) {
                Ok(found) if found == oid => return full[..len].to_string(),
                Err(e) if e.code() == ErrorCode::NotFound => return full[..len].to_string(),
                _ => {}
            }
        }
        full
    }
}

/// core.abbrev=auto: `(msb(packed object count) + 2) / 2`, at least 7.
fn auto_abbrev(repo: &Repository) -> usize {
    let mut count: u64 = 0;
    if let Ok(dir) = std::fs::read_dir(repo.commondir().join("objects").join("pack")) {
        for entry in dir.flatten() {
            let path = entry.path();
            if path.extension().is_none_or(|e| e != "idx") {
                continue;
            }
            let Ok(data) = std::fs::read(&path) else {
                continue;
            };
            // v2+ indexes start with "\377tOc" and a version; v1 starts with the fan-out table.
            let fanout = if data.starts_with(b"\xfftOc") { 8 } else { 0 };
            let at = fanout + 255 * 4;
            if let Some(b) = data.get(at..at + 4) {
                count += u64::from(u32::from_be_bytes([b[0], b[1], b[2], b[3]]));
            }
        }
    }
    if count == 0 {
        return 7;
    }
    let msb = 63 - count.leading_zeros() as usize;
    ((msb + 2) / 2).max(7)
}

/// Output buffer that stops growing past the cap; `run` then truncates and adds the marker.
struct Out<'r> {
    buf: Vec<u8>,
    abbrev: Abbrev<'r>,
}

/// How to treat libgit2's file header for one file.
#[derive(Clone, Copy)]
enum Header {
    /// Print it, with git's object name abbreviation; drop `---`/`+++` if there are no hunks
    /// (git prints them only before hunks, e.g. not for an empty file being added).
    Keep { old: Oid, new: Oid, markers: bool },
    /// Already written by the caller.
    Skip,
}

impl Out<'_> {
    fn full(&self) -> bool {
        self.buf.len() > MAX_OUTPUT_BYTES
    }

    /// Appends one line from a libgit2 patch print callback, as `git diff` would print it.
    fn line(&mut self, line: &git2::DiffLine<'_>, header: Header) -> bool {
        match (line.origin(), header) {
            (o @ ('+' | '-' | ' '), _) => {
                self.buf.push(o as u8);
                self.buf.extend_from_slice(line.content());
            }
            ('F', Header::Skip) => {}
            ('F', Header::Keep { old, new, markers }) => {
                let text = requote_paths(line.content());
                for l in text.split_inclusive(|&b| b == b'\n') {
                    if !markers && (l.starts_with(b"--- ") || l.starts_with(b"+++ ")) {
                        continue;
                    }
                    if let Some(rest) = l.strip_prefix(b"index ") {
                        // "index <old>..<new>[ <mode>]\n": re-abbreviate both names.
                        let tail = rest
                            .iter()
                            .position(|&b| b == b' ' || b == b'\n')
                            .map_or(&rest[rest.len()..], |i| &rest[i..]);
                        self.buf.extend_from_slice(
                            format!("index {}..{}", self.abbrev.hex(old), self.abbrev.hex(new))
                                .as_bytes(),
                        );
                        self.buf.extend_from_slice(tail);
                        continue;
                    }
                    self.buf.extend_from_slice(l);
                }
            }
            // git trims trailing whitespace from the function context after cutting it to 80
            // bytes ("@@ -1,2 +1,3 @@ fn x("); libgit2 cuts without trimming.
            ('H', _) => {
                let c = line.content();
                let end = c
                    .iter()
                    .rposition(|b| !b.is_ascii_whitespace())
                    .map_or(0, |i| i + 1);
                self.buf.extend_from_slice(&c[..end]);
                self.buf.push(b'\n');
            }
            // "Binary files a/x and b/x differ" carries paths: quote them like git.
            ('B', _) => self.buf.extend_from_slice(&requote_paths(line.content())),
            _ => self.buf.extend_from_slice(line.content()),
        }
        !self.full()
    }

    fn quoted(&mut self, prefix: &[u8], path: &[u8]) {
        let mut p = prefix.to_vec();
        p.extend_from_slice(path);
        quote_path(&p, &mut self.buf);
    }
}

fn path_of(bytes: &[u8]) -> PathBuf {
    PathBuf::from(String::from_utf8_lossy(bytes).into_owned())
}

/// A rename pair, rendered the way git prints it (libgit2 never saw these as a pair).
fn render_rename(
    out: &mut Out,
    sides: &mut Sides,
    (src, dst, score): (usize, usize, u64),
    context: u32,
) -> Result<(), String> {
    let (sp, dp) = (sides.all[src].path.clone(), sides.all[dst].path.clone());
    let (sm, dm) = (sides.all[src].mode, sides.all[dst].mode);
    let (so, d_o) = (sides.all[src].oid, sides.all[dst].oid);
    out.buf.extend_from_slice(b"diff --git ");
    out.quoted(b"a/", &sp);
    out.buf.push(b' ');
    out.quoted(b"b/", &dp);
    out.buf.push(b'\n');
    if sm != dm {
        out.buf
            .extend_from_slice(format!("old mode {sm:06o}\nnew mode {dm:06o}\n").as_bytes());
    }
    out.buf
        .extend_from_slice(format!("similarity index {}%\n", score * 100 / MAX_SCORE).as_bytes());
    out.buf.extend_from_slice(b"rename from ");
    out.quoted(b"", &sp);
    out.buf.extend_from_slice(b"\nrename to ");
    out.quoted(b"", &dp);
    out.buf.push(b'\n');
    if so == d_o {
        return Ok(());
    }
    let index = format!("index {}..{}", out.abbrev.hex(so), out.abbrev.hex(d_o));
    out.buf.extend_from_slice(index.as_bytes());
    if sm == dm {
        out.buf.extend_from_slice(format!(" {sm:06o}").as_bytes());
    }
    out.buf.push(b'\n');
    let old = sides.data(src).to_vec();
    let new = sides.data(dst).to_vec();
    let mut opts = diff_options(context);
    let (spath, dpath) = (path_of(&sp), path_of(&dp));
    let mut patch = Patch::from_buffers(&old, Some(&spath), &new, Some(&dpath), Some(&mut opts))
        .map_err(err)?;
    if patch.delta().flags().is_binary() {
        out.buf.extend_from_slice(b"Binary files ");
        out.quoted(b"a/", &sp);
        out.buf.extend_from_slice(b" and ");
        out.quoted(b"b/", &dp);
        out.buf.extend_from_slice(b" differ\n");
        return Ok(());
    }
    out.buf.extend_from_slice(b"--- ");
    out.quoted(b"a/", &sp);
    out.buf.extend_from_slice(b"\n+++ ");
    out.quoted(b"b/", &dp);
    out.buf.push(b'\n');
    let res = patch.print(&mut |_, _, line| out.line(&line, Header::Skip));
    match res {
        Err(_) if out.full() => Ok(()),
        r => r.map_err(err),
    }
}

/// Renders a diff (computed without libgit2's rename detection) like git: renames are found
/// with git's algorithm, and every file is printed in path order (renames under the new path).
/// `workdir` is set when the new side is the working tree, whose files may not be blobs yet.
fn render(
    repo: &Repository,
    diff: &Diff<'_>,
    context: u32,
    workdir: Option<&Path>,
) -> Result<Vec<u8>, String> {
    let mut sides = Sides::new(repo);
    let (mut srcs, mut dsts) = (Vec::new(), Vec::new()); // (delta index, side)
    for (i, d) in diff.deltas().enumerate() {
        match d.status() {
            Delta::Deleted => {
                let f = d.old_file();
                let p = f.path_bytes().unwrap_or_default();
                srcs.push((i, sides.push(p, f.mode().into(), f.id(), None)));
            }
            Delta::Added => {
                let f = d.new_file();
                let p = f.path_bytes().unwrap_or_default();
                let file = workdir.map(|w| w.join(path_of(p)));
                let mut oid = f.id();
                if oid.is_zero() {
                    if let Some(file) = &file {
                        oid = Oid::hash_file(ObjectType::Blob, file).unwrap_or(oid);
                    }
                }
                dsts.push((i, sides.push(p, f.mode().into(), oid, file)));
            }
            _ => {}
        }
    }
    // A type change (e.g. symlink -> file) arrives as a delete plus an add of the same path;
    // git never treats either half as a rename candidate.
    let typechanged: HashSet<Vec<u8>> = srcs
        .iter()
        .map(|s| sides.all[s.1].path.clone())
        .filter(|p| dsts.iter().any(|d| sides.all[d.1].path == *p))
        .collect();
    srcs.retain(|s| !typechanged.contains(&sides.all[s.1].path));
    dsts.retain(|d| !typechanged.contains(&sides.all[d.1].path));
    let src_ids: Vec<usize> = srcs.iter().map(|s| s.1).collect();
    let dst_ids: Vec<usize> = dsts.iter().map(|d| d.1).collect();
    let renames = find_renames(&mut sides, &src_ids, &dst_ids);

    enum Item {
        Delta(usize),
        Rename(usize, usize, u64),
    }
    let mut renamed_src = vec![false; diff.deltas().len()];
    let mut renamed_dst = vec![false; diff.deltas().len()];
    let mut items: Vec<(Vec<u8>, Item)> = Vec::new();
    for &(di, si, score) in &renames {
        renamed_src[srcs[si].0] = true;
        renamed_dst[dsts[di].0] = true;
        let key = sides.all[dsts[di].1].path.clone();
        items.push((key, Item::Rename(srcs[si].1, dsts[di].1, score)));
    }
    for (i, d) in diff.deltas().enumerate() {
        if renamed_src[i] || renamed_dst[i] {
            continue;
        }
        let f = if d.status() == Delta::Deleted {
            d.old_file()
        } else {
            d.new_file()
        };
        items.push((f.path_bytes().unwrap_or_default().to_vec(), Item::Delta(i)));
    }
    items.sort_by(|a, b| a.0.cmp(&b.0));

    let mut out = Out {
        buf: Vec::new(),
        abbrev: Abbrev::new(repo),
    };
    for (_, item) in items {
        if out.full() {
            break;
        }
        match item {
            Item::Rename(s, d, score) => {
                render_rename(&mut out, &mut sides, (s, d, score), context)?
            }
            Item::Delta(i) => {
                let Some(mut patch) = Patch::from_diff(diff, i).map_err(err)? else {
                    continue;
                };
                let delta = patch.delta();
                let header = Header::Keep {
                    old: delta.old_file().id(),
                    new: delta.new_file().id(),
                    markers: patch.num_hunks() > 0 || delta.flags().is_binary(),
                };
                let res = patch.print(&mut |_, _, line| out.line(&line, header));
                match res {
                    Err(_) if out.full() => {}
                    r => r.map_err(err)?,
                }
            }
        }
    }
    Ok(out.buf)
}

/// libgit2 C-quotes every path containing a non-ASCII byte (`"a/\303\274ber.txt"`), like git
/// with `core.quotepath=on`. The CLI ran with `core.quotepath=off`, which keeps such bytes raw
/// and quotes only for control characters, `"` and `\\`. Rewrites every quoted path in `text`
/// to that form.
fn requote_paths(text: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    let mut i = 0;
    while i < text.len() {
        if text[i] != b'"' {
            out.push(text[i]);
            i += 1;
            continue;
        }
        // Decode a C-quoted string; if it is malformed, copy it through unchanged.
        let mut raw = Vec::new();
        let mut j = i + 1;
        let mut closed = false;
        while j < text.len() {
            match text[j] {
                b'"' => {
                    closed = true;
                    j += 1;
                    break;
                }
                b'\\' if j + 1 < text.len() => {
                    let c = text[j + 1];
                    let simple = match c {
                        b'a' => Some(7),
                        b'b' => Some(8),
                        b't' => Some(b'\t'),
                        b'n' => Some(b'\n'),
                        b'v' => Some(11),
                        b'f' => Some(12),
                        b'r' => Some(b'\r'),
                        b'"' | b'\\' => Some(c),
                        _ => None,
                    };
                    if let Some(b) = simple {
                        raw.push(b);
                        j += 2;
                    } else if j + 3 < text.len()
                        && text[j + 1..j + 4].iter().all(|d| (b'0'..=b'7').contains(d))
                    {
                        let v = text[j + 1..j + 4]
                            .iter()
                            .fold(0u32, |acc, d| acc * 8 + u32::from(d - b'0'));
                        raw.push(v as u8);
                        j += 4;
                    } else {
                        break;
                    }
                }
                b'\n' => break,
                b => {
                    raw.push(b);
                    j += 1;
                }
            }
        }
        if !closed {
            out.push(b'"');
            i += 1;
            continue;
        }
        quote_path(&raw, &mut out);
        i = j;
    }
    out
}

/// git's `quote_c_style` with `core.quotepath=off`.
fn quote_path(raw: &[u8], out: &mut Vec<u8>) {
    let needs = |b: u8| b < 0x20 || b == b'"' || b == b'\\' || b == 0x7f;
    if !raw.iter().any(|&b| needs(b)) {
        out.extend_from_slice(raw);
        return;
    }
    out.push(b'"');
    for &b in raw {
        match b {
            7 => out.extend_from_slice(b"\\a"),
            8 => out.extend_from_slice(b"\\b"),
            b'\t' => out.extend_from_slice(b"\\t"),
            b'\n' => out.extend_from_slice(b"\\n"),
            11 => out.extend_from_slice(b"\\v"),
            12 => out.extend_from_slice(b"\\f"),
            b'\r' => out.extend_from_slice(b"\\r"),
            b'"' => out.extend_from_slice(b"\\\""),
            b'\\' => out.extend_from_slice(b"\\\\"),
            b if needs(b) => out.extend_from_slice(format!("\\{b:03o}").as_bytes()),
            b => out.push(b),
        }
    }
    out.push(b'"');
}

fn diff_working(repo: &Repository, context: u32) -> Result<Vec<u8>, String> {
    let head = match repo.head() {
        Ok(h) => h,
        // The UI recognises this case by the mention of HEAD (a repo without commits).
        Err(e) if e.code() == ErrorCode::UnbornBranch || e.code() == ErrorCode::NotFound => {
            return Err("ambiguous argument 'HEAD': unknown revision (no commits yet)".into())
        }
        Err(e) => return Err(err(e)),
    };
    let tree = head.peel_to_tree().map_err(err)?;
    let mut opts = diff_options(context);
    let diff = repo
        .diff_tree_to_workdir_with_index(Some(&tree), Some(&mut opts))
        .map_err(err)?;
    render(repo, &diff, context, repo.workdir())
}

fn diff_commit(repo: &Repository, hash: &str, context: u32) -> Result<Vec<u8>, String> {
    let commit = match Oid::from_str(hash) {
        Ok(oid) if hash.len() == 40 => repo.find_commit(oid),
        _ => repo.revparse_single(hash).and_then(|o| o.peel_to_commit()),
    }
    .map_err(|e| match e.code() {
        ErrorCode::Ambiguous => format!("short commit hash {hash} is ambiguous"),
        _ => format!("unknown commit: {hash}"),
    })?;
    let tree = commit.tree().map_err(err)?;
    // First parent; a root commit is shown against the empty tree.
    let parent_tree = match commit.parent(0) {
        Ok(p) => Some(p.tree().map_err(err)?),
        Err(_) => None,
    };
    let mut opts = diff_options(context);
    let diff = repo
        .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut opts))
        .map_err(err)?;
    render(repo, &diff, context, None)
}

#[tauri::command]
pub async fn git_run(roots: State<'_, Roots>, root: String, op: GitOp) -> Result<String, String> {
    let root = allowed_root(&roots, &root)?;
    tauri::async_runtime::spawn_blocking(move || run(&root, &op))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    //! The code under test uses git2 only; the git CLI is used here to build fixtures and as the
    //! reference output the frontend parsers were written against.
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;
    use std::sync::atomic::{AtomicU32, Ordering};

    fn cli_cmd(dir: &Path, args: &[&str]) -> Command {
        let mut c = Command::new("git");
        c.args(["-c", "core.quotepath=off", "--no-pager"])
            .args(args)
            .current_dir(dir)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_AUTHOR_NAME", "Ada Lovelace")
            .env("GIT_AUTHOR_EMAIL", "ada@example.com")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@t");
        c
    }

    /// Runs git and returns stdout, panicking on failure.
    fn git(dir: &Path, args: &[&str]) -> Vec<u8> {
        let out = cli_cmd(dir, args).output().unwrap();
        assert!(
            out.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        out.stdout
    }

    fn commit_at(dir: &Path, msg: &str, date: &str) {
        let out = cli_cmd(dir, &["commit", "-q", "--allow-empty", "-m", msg])
            .env("GIT_AUTHOR_DATE", date)
            .env("GIT_COMMITTER_DATE", date)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    /// A throwaway repository directory, removed when the test ends.
    struct TempRepo(PathBuf);

    impl std::ops::Deref for TempRepo {
        type Target = Path;
        fn deref(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempRepo {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn temp_repo(name: &str) -> TempRepo {
        static N: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "aic-git2-{name}-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        git(&dir, &["init", "-q", "-b", "main"]);
        TempRepo(dir)
    }

    fn cli_text(dir: &Path, args: &[&str]) -> String {
        String::from_utf8_lossy(&git(dir, args)).into_owned()
    }

    fn assert_status_matches(dir: &Path) -> String {
        let ours = run(dir, &GitOp::Status).unwrap();
        let theirs = cli_text(dir, &["status", "--porcelain=v1", "-b", "-z"]);
        assert_eq!(ours, theirs, "status differs in {dir:?}");
        ours
    }

    fn assert_working_diff_matches(dir: &Path, context: u32) -> String {
        let ours = run(dir, &GitOp::DiffWorking { context }).unwrap();
        let u = format!("-U{context}");
        let theirs = cli_text(
            dir,
            &[
                "diff",
                &u,
                "--no-color",
                "--no-ext-diff",
                "--find-renames",
                "HEAD",
            ],
        );
        assert_eq!(ours, theirs, "working diff differs (U{context}) in {dir:?}");
        ours
    }

    fn assert_commit_diff_matches(dir: &Path, hash: &str, context: u32) -> String {
        let ours = run(
            dir,
            &GitOp::DiffCommit {
                hash: hash.into(),
                context,
            },
        )
        .unwrap();
        let u = format!("-U{context}");
        let theirs = cli_text(
            dir,
            &[
                "show",
                "--format=",
                &u,
                "--no-color",
                "--no-ext-diff",
                "--find-renames",
                hash,
            ],
        );
        assert_eq!(ours, theirs, "commit diff differs for {hash} in {dir:?}");
        ours
    }

    fn assert_log_matches(dir: &Path, limit: u32) -> String {
        let ours = run(dir, &GitOp::Log { limit }).unwrap();
        let n = format!("-n{limit}");
        let theirs = cli_text(dir, &["log", &n, "--format=%H%x1f%an%x1f%aI%x1f%s%x1e"]);
        assert_eq!(ours, theirs, "log differs in {dir:?}");
        ours
    }

    fn lines(n: usize, tag: &str) -> String {
        (1..=n).map(|i| format!("{tag} line {i}\n")).collect()
    }

    /// A repository with history and every kind of uncommitted change.
    fn busy_repo() -> TempRepo {
        let dir = temp_repo("busy");
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::write(dir.join(".gitignore"), "*.log\n").unwrap();
        fs::write(dir.join("a.txt"), lines(40, "a")).unwrap();
        fs::write(dir.join("b.txt"), "b1\nb2\n").unwrap();
        fs::write(dir.join("c.txt"), "c\n").unwrap();
        fs::write(dir.join("d.txt"), "d\n").unwrap();
        fs::write(dir.join("old.txt"), lines(30, "rename me")).unwrap();
        fs::write(
            dir.join("src/lib.rs"),
            "fn main() {\n    println!(\"hi\");\n}\n",
        )
        .unwrap();
        fs::write(dir.join("noeol.txt"), "x\ny").unwrap();
        fs::write(dir.join("über.txt"), "ü\n").unwrap();
        fs::write(dir.join("we\"ird\tname.txt"), "q\n").unwrap();
        fs::write(dir.join("bin.dat"), [0u8, 1, 2, 3, 0, 255]).unwrap();
        git(&dir, &["add", "."]);
        commit_at(&dir, "Initial import", "2026-01-02T03:04:05+03:00");
        fs::write(dir.join("a.txt"), lines(41, "a")).unwrap();
        git(&dir, &["add", "."]);
        commit_at(
            &dir,
            "  \nSecond: a longer\nsubject line   \n\nbody text\n",
            "2026-05-06T07:08:09-05:30",
        );
        commit_at(&dir, "Empty commit at UTC", "2026-06-01T00:00:00+00:00");

        // Unstaged modification in the middle of a file (with function context in the hunk).
        let mut a = lines(41, "a");
        a = a.replace("a line 20\n", "a line twenty\n");
        fs::write(dir.join("a.txt"), a).unwrap();
        // Staged modification plus a further unstaged one: MM.
        fs::write(dir.join("b.txt"), "b1\nb2\nb3\n").unwrap();
        git(&dir, &["add", "b.txt"]);
        fs::write(dir.join("b.txt"), "b0\nb1\nb2\nb3\n").unwrap();
        // Deleted in the worktree only, and deleted in the index.
        fs::remove_file(dir.join("c.txt")).unwrap();
        git(&dir, &["rm", "-q", "d.txt"]);
        // Staged rename with a small edit.
        git(&dir, &["mv", "old.txt", "new.txt"]);
        let mut renamed = lines(30, "rename me");
        renamed.push_str("one more\n");
        fs::write(dir.join("new.txt"), renamed).unwrap();
        git(&dir, &["add", "new.txt"]);
        // Added file, staged.
        fs::write(dir.join("added.txt"), "fresh\n").unwrap();
        git(&dir, &["add", "added.txt"]);
        // No newline at end of file, non-ASCII path, binary change, code change.
        fs::write(dir.join("noeol.txt"), "x\nz").unwrap();
        fs::write(dir.join("über.txt"), "ü2\n").unwrap();
        fs::write(dir.join("we\"ird\tname.txt"), "q2\n").unwrap();
        fs::write(dir.join("bin.dat"), [0u8, 9, 9, 9, 0, 255]).unwrap();
        fs::write(
            dir.join("src/lib.rs"),
            "fn main() {\n    println!(\"hello\");\n}\n",
        )
        .unwrap();
        // An empty file being added: git prints no ---/+++ lines for it.
        fs::write(dir.join("empty-new.txt"), "").unwrap();
        git(&dir, &["add", "empty-new.txt"]);
        // Untracked file, untracked directory (shown collapsed), ignored file.
        fs::write(dir.join("zz-untracked.txt"), "u\n").unwrap();
        fs::create_dir_all(dir.join("newdir/deeper")).unwrap();
        fs::write(dir.join("newdir/deeper/f.txt"), "f\n").unwrap();
        fs::write(dir.join("debug.log"), "ignored\n").unwrap();
        // Directories git does not list: only ignored content, and empty.
        fs::create_dir_all(dir.join("logs")).unwrap();
        fs::write(dir.join("logs/x.log"), "ignored\n").unwrap();
        fs::create_dir_all(dir.join("empty-dir")).unwrap();
        // Staged rename of a code file, then edited again in the worktree: RM.
        git(&dir, &["mv", "src/lib.rs", "src/main.rs"]);
        fs::write(
            dir.join("src/main.rs"),
            "fn main() {\n    println!(\"bye\");\n}\n",
        )
        .unwrap();
        dir
    }

    #[test]
    fn status_matches_cli_for_every_change_kind() {
        let dir = busy_repo();
        let status = assert_status_matches(&dir);
        for expected in [
            "## main\0",
            " M a.txt\0",
            "MM b.txt\0",
            " D c.txt\0",
            "D  d.txt\0",
            "R  new.txt\0old.txt\0",
            "A  added.txt\0",
            " M über.txt\0",
            " M we\"ird\tname.txt\0",
            "RM src/main.rs\0src/lib.rs\0",
            "?? newdir/\0",
            "?? zz-untracked.txt\0",
        ] {
            assert!(
                status.contains(expected),
                "missing {expected:?} in {status:?}"
            );
        }
        assert!(!status.contains("debug.log") && !status.contains("logs/"));
        assert!(!status.contains("empty-dir"));
    }

    #[test]
    fn clean_repo_status_and_empty_working_diff() {
        let dir = temp_repo("clean");
        fs::write(dir.join("a.txt"), "a\n").unwrap();
        git(&dir, &["add", "."]);
        commit_at(&dir, "one", "2026-01-01T12:00:00+01:00");
        assert_eq!(assert_status_matches(&dir), "## main\0");
        assert_eq!(assert_working_diff_matches(&dir, 3), "");
    }

    #[test]
    fn working_diff_matches_cli() {
        let dir = busy_repo();
        let d = assert_working_diff_matches(&dir, 3);
        assert!(
            d.contains("rename from old.txt\nrename to new.txt\n"),
            "{d}"
        );
        assert!(d.contains("\\ No newline at end of file\n"));
        assert!(d.contains("Binary files a/bin.dat and b/bin.dat differ\n"));
        assert!(d.contains("deleted file mode 100644"));
        assert!(d.contains("new file mode 100644"));
        assert!(d.contains("diff --git a/über.txt b/über.txt\n"));
        assert!(d.contains("diff --git \"a/we\\\"ird\\tname.txt\" \"b/we\\\"ird\\tname.txt\"\n"));
        assert!(d.contains("new file mode 100644\nindex 0000000..e69de29\ndiff --git"));
        assert_working_diff_matches(&dir, 0);
        assert_working_diff_matches(&dir, 30);
    }

    #[test]
    fn hunk_function_context_is_trimmed_like_git() {
        let dir = temp_repo("funcname");
        // The function line is cut at 80 bytes, which here ends in spaces that git trims.
        let func = format!("fn long_function_name({}x: u8) {{\n", " ".repeat(60));
        let body: String = (1..=20).map(|i| format!("    body line {i}\n")).collect();
        fs::write(dir.join("f.rs"), format!("{func}{body}")).unwrap();
        git(&dir, &["add", "."]);
        commit_at(&dir, "one", "2026-01-01T00:00:00+00:00");
        fs::write(
            dir.join("f.rs"),
            format!("{func}{}", body.replace("body line 15", "changed")),
        )
        .unwrap();
        let d = assert_working_diff_matches(&dir, 3);
        assert!(d.contains("@@ fn long_function_name(\n"), "{d}");
    }

    #[cfg(unix)]
    #[test]
    fn type_changes_are_not_rename_candidates() {
        let dir = temp_repo("typechange");
        fs::write(dir.join("data.toml"), lines(30, "data")).unwrap();
        std::os::unix::fs::symlink("../data.toml", dir.join("link.toml")).unwrap();
        git(&dir, &["add", "."]);
        commit_at(&dir, "one", "2026-01-01T00:00:00+00:00");
        // The regular file moves to where the symlink was.
        fs::remove_file(dir.join("link.toml")).unwrap();
        fs::rename(dir.join("data.toml"), dir.join("link.toml")).unwrap();
        git(&dir, &["add", "-A"]);
        let s = assert_status_matches(&dir);
        assert!(
            s.contains("T  link.toml\0") && s.contains("D  data.toml\0"),
            "{s:?}"
        );
        let d = assert_working_diff_matches(&dir, 3);
        assert!(d.contains("deleted file mode 120000") && !d.contains("rename from"));
        commit_at(&dir, "two", "2026-01-02T00:00:00+00:00");
        let head = cli_text(&dir, &["rev-parse", "HEAD"]);
        assert_commit_diff_matches(&dir, head.trim(), 3);
    }

    #[test]
    fn log_matches_cli_including_dates_and_subjects() {
        let dir = busy_repo();
        let log = assert_log_matches(&dir, 30);
        assert!(log.contains("\x1fAda Lovelace\x1f2026-05-06T07:08:09-05:30\x1fSecond: a longer subject line\x1e\n"), "{log:?}");
        assert!(log.contains("\x1f2026-01-02T03:04:05+03:00\x1fInitial import\x1e\n"));
        assert!(log.contains("\x1f2026-06-01T00:00:00+00:00\x1fEmpty commit at UTC\x1e\n"));
        assert_eq!(assert_log_matches(&dir, 1).matches('\x1e').count(), 1);
        assert_eq!(
            iso_strict(Time::new(-1, 0)),
            "1969-12-31T23:59:59+00:00",
            "pre-epoch dates"
        );
        assert_eq!(
            iso_strict(Time::new(951_782_400, 60)),
            "2000-02-29T01:00:00+01:00"
        );
    }

    #[test]
    fn commit_diffs_match_cli_including_root_and_short_hashes() {
        let dir = busy_repo();
        git(&dir, &["add", "-A"]);
        commit_at(&dir, "everything", "2026-07-01T10:00:00+02:00");
        let hashes = cli_text(&dir, &["log", "--format=%H"]);
        let hashes: Vec<&str> = hashes.lines().collect();
        assert_eq!(hashes.len(), 4);
        for h in &hashes {
            assert_commit_diff_matches(&dir, h, 3);
            assert_commit_diff_matches(&dir, h, 0);
        }
        // Root commit against the empty tree.
        let root = assert_commit_diff_matches(&dir, hashes[3], 3);
        assert!(root.contains("new file mode 100644\n"));
        assert!(root.contains("+a line 1\n"));
        // The empty commit has no diff; an abbreviated hash works.
        assert_eq!(assert_commit_diff_matches(&dir, &hashes[1][..7], 3), "");
        let last = assert_commit_diff_matches(&dir, &hashes[0][..10], 5);
        assert!(last.contains("rename from old.txt"));
        assert!(run(
            &dir,
            &GitOp::DiffCommit {
                hash: "deadbeef".into(),
                context: 3
            }
        )
        .unwrap_err()
        .contains("deadbeef"));
    }

    #[test]
    fn empty_repository() {
        let dir = temp_repo("empty");
        assert_eq!(assert_status_matches(&dir), "## No commits yet on main\0");
        fs::write(dir.join("staged.txt"), "s\n").unwrap();
        fs::write(dir.join("loose.txt"), "l\n").unwrap();
        git(&dir, &["add", "staged.txt"]);
        let s = assert_status_matches(&dir);
        assert!(
            s.contains("A  staged.txt\0") && s.contains("?? loose.txt\0"),
            "{s:?}"
        );
        // The UI hides diff errors that mention HEAD (nothing to diff against yet).
        assert!(run(&dir, &GitOp::DiffWorking { context: 3 })
            .unwrap_err()
            .contains("HEAD"));
        assert!(run(&dir, &GitOp::Log { limit: 5 })
            .unwrap_err()
            .contains("does not have any commits yet"));
    }

    #[test]
    fn upstream_ahead_behind_and_gone() {
        let origin = temp_repo("origin");
        fs::write(origin.join("f.txt"), "1\n").unwrap();
        git(&origin, &["add", "."]);
        commit_at(&origin, "base", "2026-01-01T00:00:00+00:00");
        let clone = TempRepo(origin.with_extension("clone"));
        let _ = fs::remove_dir_all(&*clone);
        git(
            &origin,
            &[
                "clone",
                "-q",
                origin.to_str().unwrap(),
                clone.to_str().unwrap(),
            ],
        );
        assert_eq!(assert_status_matches(&clone), "## main...origin/main\0");

        commit_at(&clone, "local 1", "2026-01-02T00:00:00+00:00");
        commit_at(&clone, "local 2", "2026-01-03T00:00:00+00:00");
        assert_eq!(
            assert_status_matches(&clone),
            "## main...origin/main [ahead 2]\0"
        );
        commit_at(&origin, "remote 1", "2026-01-04T00:00:00+00:00");
        git(&clone, &["fetch", "-q"]);
        assert_eq!(
            assert_status_matches(&clone),
            "## main...origin/main [ahead 2, behind 1]\0"
        );
        git(&clone, &["reset", "-q", "--hard", "origin/main~1"]);
        assert_eq!(
            assert_status_matches(&clone),
            "## main...origin/main [behind 1]\0"
        );
        // Upstream configured but the remote-tracking branch no longer exists.
        git(
            &clone,
            &["config", "branch.main.merge", "refs/heads/vanished"],
        );
        assert_eq!(
            assert_status_matches(&clone),
            "## main...origin/vanished [gone]\0"
        );
        // Detached HEAD.
        git(&clone, &["checkout", "-q", "--detach"]);
        assert_eq!(assert_status_matches(&clone), "## HEAD (no branch)\0");
    }

    #[test]
    fn merge_conflict_status() {
        let dir = temp_repo("conflict");
        fs::write(dir.join("f.txt"), "base\n").unwrap();
        fs::write(dir.join("g.txt"), "base\n").unwrap();
        git(&dir, &["add", "."]);
        commit_at(&dir, "base", "2026-01-01T00:00:00+00:00");
        git(&dir, &["checkout", "-q", "-b", "other"]);
        fs::write(dir.join("f.txt"), "theirs\n").unwrap();
        fs::write(dir.join("both.txt"), "theirs\n").unwrap();
        git(&dir, &["rm", "-q", "g.txt"]);
        git(&dir, &["add", "."]);
        commit_at(&dir, "theirs", "2026-01-02T00:00:00+00:00");
        git(&dir, &["checkout", "-q", "main"]);
        fs::write(dir.join("f.txt"), "ours\n").unwrap();
        fs::write(dir.join("both.txt"), "ours\n").unwrap();
        fs::write(dir.join("g.txt"), "changed\n").unwrap();
        git(&dir, &["add", "."]);
        commit_at(&dir, "ours", "2026-01-03T00:00:00+00:00");
        let merge = cli_cmd(&dir, &["merge", "-q", "other"]).output().unwrap();
        assert!(!merge.status.success(), "merge should conflict");
        let s = assert_status_matches(&dir);
        for expected in ["UU f.txt\0", "AA both.txt\0", "UD g.txt\0"] {
            assert!(s.contains(expected), "missing {expected:?} in {s:?}");
        }
    }

    #[test]
    fn rejects_bad_hashes_and_non_repositories() {
        let dir = temp_repo("hashes");
        commit_at(&dir, "one", "2026-01-01T00:00:00+00:00");
        for hash in [
            "HEAD; rm -rf /",
            "--output=/tmp/x",
            "abc",
            "HEAD",
            &"a".repeat(41),
        ] {
            assert!(
                run(
                    &dir,
                    &GitOp::DiffCommit {
                        hash: hash.into(),
                        context: 3
                    }
                )
                .unwrap_err()
                .starts_with("invalid commit hash"),
                "{hash}"
            );
        }

        let plain = std::env::temp_dir().join(format!("aic-nogit-{}", std::process::id()));
        fs::create_dir_all(&plain).unwrap();
        // GIT_CEILING_DIRECTORIES keeps the search from finding a repository above the temp dir.
        std::env::set_var("GIT_CEILING_DIRECTORIES", std::env::temp_dir());
        assert_eq!(
            run(&plain, &GitOp::Status).unwrap_err(),
            "not a git repository"
        );
    }

    #[test]
    fn renames_follow_git_rules() {
        let dir = temp_repo("renames");
        fs::create_dir_all(dir.join("lib")).unwrap();
        fs::create_dir_all(dir.join("pkg")).unwrap();
        fs::write(dir.join("empty"), "").unwrap();
        fs::write(dir.join("zold.txt"), lines(50, "z")).unwrap();
        fs::write(dir.join("mid.txt"), "m\n").unwrap();
        fs::write(dir.join("crlf.txt"), lines(20, "c").replace('\n', "\r\n")).unwrap();
        fs::write(dir.join("lib/util.rs"), lines(40, "util")).unwrap();
        fs::write(dir.join("lib/twin1.txt"), lines(40, "twin")).unwrap();
        fs::write(dir.join("lib/twin2.txt"), lines(40, "twin")).unwrap();
        let mut bin = vec![0u8; 3000];
        bin.extend((0..3000u32).map(|i| (i % 251) as u8));
        fs::write(dir.join("blob.bin"), &bin).unwrap();
        fs::write(dir.join("half.txt"), lines(10, "half")).unwrap();
        git(&dir, &["add", "."]);
        commit_at(&dir, "base", "2026-01-01T00:00:00+00:00");

        git(&dir, &["mv", "empty", "empty2"]); // empty files are renamed too
        git(&dir, &["mv", "zold.txt", "anew.txt"]); // listed under the new name
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(dir.join("anew.txt"), fs::Permissions::from_mode(0o755)).unwrap();
            git(&dir, &["add", "anew.txt"]);
        }
        git(&dir, &["rm", "-q", "--cached", "mid.txt"]); // "D " and "??"
        git(&dir, &["mv", "crlf.txt", "crlf2.txt"]);
        git(&dir, &["mv", "lib/util.rs", "pkg/util.rs"]); // same basename, edited
        let mut util = lines(40, "util");
        util.push_str(&lines(8, "more"));
        fs::write(dir.join("pkg/util.rs"), util).unwrap();
        git(&dir, &["add", "pkg/util.rs"]);
        git(&dir, &["mv", "lib/twin1.txt", "twin.txt"]); // identical sources: tie-break
        git(&dir, &["rm", "-q", "lib/twin2.txt"]);
        bin[10] = 7;
        fs::remove_file(dir.join("blob.bin")).unwrap();
        fs::write(dir.join("blob2.bin"), &bin).unwrap(); // binary rename with edits
        git(&dir, &["add", "-A", "blob.bin", "blob2.bin"]);
        // Below 50% similar: stays a delete plus an add.
        fs::remove_file(dir.join("half.txt")).unwrap();
        fs::write(dir.join("other.txt"), lines(4, "half") + &lines(8, "new")).unwrap();
        git(&dir, &["add", "-A", "half.txt", "other.txt"]);

        let s = assert_status_matches(&dir);
        for expected in [
            "R  anew.txt\0zold.txt\0",
            "R  empty2\0empty\0",
            "D  mid.txt\0",
            "?? mid.txt\0",
            "R  pkg/util.rs\0lib/util.rs\0",
        ] {
            assert!(s.contains(expected), "missing {expected:?} in {s:?}");
        }
        let d = assert_working_diff_matches(&dir, 3);
        #[cfg(unix)]
        assert!(
            d.contains(
                "old mode 100644\nnew mode 100755\nsimilarity index 100%\nrename from zold.txt\n"
            ),
            "{d}"
        );
        assert!(
            d.contains("Binary files a/blob.bin and b/blob2.bin differ\n"),
            "{d}"
        );
        assert!(d.contains("deleted file mode 100644\nindex") && d.contains("a/half.txt"));
        git(&dir, &["commit", "-qm", "moves"]);
        let head = cli_text(&dir, &["rev-parse", "HEAD"]);
        assert_commit_diff_matches(&dir, head.trim(), 3);

        // Worktree-only changes against HEAD: a staged add edited again on disk, then renamed.
        fs::write(dir.join("anew.txt"), lines(50, "z") + "tail\n").unwrap();
        git(&dir, &["mv", "anew.txt", "renamed-again.txt"]);
        fs::write(
            dir.join("renamed-again.txt"),
            lines(50, "z") + "tail\nmore\n",
        )
        .unwrap();
        assert_status_matches(&dir);
        assert_working_diff_matches(&dir, 3);
    }

    #[test]
    fn huge_diffs_are_truncated_with_marker() {
        let dir = temp_repo("huge");
        fs::write(dir.join("big.txt"), "").unwrap();
        git(&dir, &["add", "."]);
        commit_at(&dir, "empty", "2026-01-01T00:00:00+00:00");
        let line = "x".repeat(99) + "\n";
        fs::write(dir.join("big.txt"), line.repeat(50_000)).unwrap();
        let out = run(&dir, &GitOp::DiffWorking { context: 3 }).unwrap();
        assert!(out.ends_with("\n\0TRUNCATED\0"));
        assert_eq!(out.len(), MAX_OUTPUT_BYTES + TRUNCATED_MARKER.len());
    }
}
