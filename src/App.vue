<template>
  <router-view />
</template>

<style>
/* Quasar uppercases buttons; CSS uppercasing turns Turkish "i" into "I" instead of "İ". */
.q-btn {
  text-transform: none;
}

/* Vertical spacing without Quasar's negative-margin gutters, which misalign when nested. */
.stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
</style>

<style>
/* Theme-aware tinted surfaces. Quasar's bg-*-1 palette classes are fixed light colours and
   turn into glaring, low-contrast boxes in dark mode; use these instead. */
.tone-info { background: #e3f2fd; color: inherit; }
.tone-warn { background: #fff3e0; color: #8a3b00; }
.tone-danger { background: #ffebee; color: #b71c1c; }
.tone-muted { background: #f5f5f5; color: inherit; }
.text-warn { color: #e65100; }
.text-soft { opacity: 0.7; }
.body--dark .tone-info { background: rgba(33, 150, 243, 0.12); }
.body--dark .tone-warn { background: rgba(255, 152, 0, 0.12); color: #ffcc80; }
.body--dark .tone-danger { background: rgba(244, 67, 54, 0.14); color: #ef9a9a; }
.body--dark .tone-muted { background: rgba(255, 255, 255, 0.06); }
.body--dark .text-warn { color: #ffb74d; }
</style>
