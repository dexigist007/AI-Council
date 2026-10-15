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
