<script setup lang="ts">
import { useIdentify, useShieldLabs } from '@shieldlabs-ai/vue';
import { ref } from 'vue';

const email = ref('');
const password = ref('');
const message = ref('');

// `status` is 'loading', 'ready' or 'error'. identify() waits for the agent itself, so the form
// never has to wait for 'ready'.
const { status } = useShieldLabs();
// For a signed-in user, pass the User HID computed on your server: useIdentify({ userId: () => hid }).
const { identify, isLoading, error } = useIdentify();

async function onSubmit(): Promise<void> {
  // One identification per submission. `null` when there is none: your server then treats the
  // signup as unverified.
  const result = await identify();
  const requestId = result?.requestId ?? null;

  // fetch() keeps the page alive while the agent finishes posting the identification.
  const response = await fetch('/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.value, password: password.value, requestId }),
  });

  message.value = response.ok
    ? 'Account created.'
    : `Your server answered ${String(response.status)}. It would receive requestId ${requestId ?? '(none)'}.`;
}
</script>

<template>
  <form @submit.prevent="onSubmit">
    <label>Email <input v-model="email" name="email" type="email" autocomplete="email" required /></label>
    <label>
      Password
      <input v-model="password" name="password" type="password" autocomplete="new-password" required />
    </label>
    <button type="submit" :disabled="isLoading">{{ isLoading ? 'Checking...' : 'Sign up' }}</button>
  </form>
  <p role="status">{{ message }}</p>
  <p v-if="error" class="note">ShieldLabs {{ error.code }}: {{ error.message }}</p>
  <p v-else-if="status === 'error'" class="note">The ShieldLabs agent could not load. The form still works.</p>
</template>
