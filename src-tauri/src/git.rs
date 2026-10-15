//! Read-only git access. Only the operations in `GitOp` exist; arguments are fixed here and the
//! only user-supplied value (a commit hash) is validated. No shell is involved.

use serde::Deserialize;
use std::path::Path;
use std::process::Command;
use tauri::State;

use crate::projects::{allowed_root, Roots};

/// Diff output is capped so a huge change cannot freeze the UI; the frontend reports truncation.
const MAX_OUTPUT_BYTES: usize = 4 * 1024 * 1024;

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

fn args_for(op: &GitOp) -> Result<Vec<String>, String> {
    let ctx = |c: &u32| format!("-U{}", (*c).clamp(0, 30));
    let diff_flags = ["--no-color", "--no-ext-diff", "--find-renames"];
    Ok(match op {
        GitOp::Status => vec![
            "status".into(),
            "--porcelain=v1".into(),
            "-b".into(),
            "-z".into(),
        ],
        GitOp::Log { limit } => vec![
            "log".into(),
            format!("-n{}", (*limit).clamp(1, 200)),
            // unit separator between fields, record separator between commits
            "--format=%H%x1f%an%x1f%aI%x1f%s%x1e".into(),
        ],
        GitOp::DiffWorking { context } => {
            let mut a = vec!["diff".to_string(), ctx(context)];
            a.extend(diff_flags.iter().map(|s| s.to_string()));
            a.push("HEAD".into());
            a
        }
        GitOp::DiffCommit { hash, context } => {
            if !(4..=40).contains(&hash.len()) || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
                return Err(format!("invalid commit hash: {hash}"));
            }
            let mut a = vec!["show".to_string(), "--format=".into(), ctx(context)];
            a.extend(diff_flags.iter().map(|s| s.to_string()));
            a.push(hash.clone());
            a
        }
    })
}

pub fn run(root: &Path, op: &GitOp) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-c")
        .arg("core.quotepath=off")
        .arg("--no-pager")
        .args(args_for(op)?)
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0") // never take locks: we only read
        .output()
        .map_err(|e| format!("git could not be started (is it installed?): {e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.contains("not a git repository") {
            "not a git repository".into()
        } else {
            err
        });
    }
    let mut out = output.stdout;
    if out.len() > MAX_OUTPUT_BYTES {
        out.truncate(MAX_OUTPUT_BYTES);
        out.extend_from_slice(b"\n\x00TRUNCATED\x00");
    }
    Ok(String::from_utf8_lossy(&out).into_owned())
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
    use super::*;
    use std::fs;

    fn git(dir: &Path, args: &[&str]) {
        let ok = Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@t")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@t")
            .status()
            .unwrap()
            .success();
        assert!(ok, "git {args:?}");
    }

    #[test]
    fn reads_status_log_and_diffs() {
        let dir = std::env::temp_dir().join(format!("aic-git-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        git(&dir, &["init", "-q", "-b", "main"]);
        fs::write(dir.join("a.txt"), "one\n").unwrap();
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-qm", "first"]);
        fs::write(dir.join("a.txt"), "one\ntwo\n").unwrap();

        let status = run(&dir, &GitOp::Status).unwrap();
        assert!(status.starts_with("## main"), "{status}");
        assert!(status.contains(" M a.txt"));
        let log = run(&dir, &GitOp::Log { limit: 5 }).unwrap();
        assert!(log.contains("\x1ffirst\x1e"));
        let hash = log.split('\x1f').next().unwrap().to_string();
        assert!(run(&dir, &GitOp::DiffWorking { context: 3 })
            .unwrap()
            .contains("+two"));
        assert!(run(&dir, &GitOp::DiffCommit { hash, context: 3 })
            .unwrap()
            .contains("+one"));
        assert!(run(
            &dir,
            &GitOp::DiffCommit {
                hash: "HEAD; rm -rf /".into(),
                context: 3
            }
        )
        .is_err());
        assert!(run(
            &dir,
            &GitOp::DiffCommit {
                hash: "--output=/tmp/x".into(),
                context: 3
            }
        )
        .is_err());
    }

    #[test]
    fn reports_non_repositories() {
        let dir = std::env::temp_dir().join(format!("aic-nogit-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        // GIT_CEILING_DIRECTORIES keeps git from finding a repository above the temp dir.
        std::env::set_var("GIT_CEILING_DIRECTORIES", std::env::temp_dir());
        assert_eq!(
            run(&dir, &GitOp::Status).unwrap_err(),
            "not a git repository"
        );
    }
}
