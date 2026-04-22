<script setup lang="ts">
const input = ref('')
const loading = ref(false)
const chatId = crypto.randomUUID()

const { user } = useUserSession()

const greeting = computed(() => {
  const hour = new Date().getHours()
  let timeGreeting = '晚上好'
  if (hour < 12) timeGreeting = '早上好'
  else if (hour < 18) timeGreeting = '下午好'

  const name = user.value?.name?.split(' ')[0] || user.value?.username

  return name ? `${timeGreeting}, ${name}` : `${timeGreeting}`
})

const { csrf, headerName } = useCsrf()

async function createChat(prompt: string) {
  input.value = prompt
  loading.value = true

  const chat = await $fetch('/api/chats', {
    method: 'POST',
    headers: { [headerName]: csrf },
    body: {
      id: chatId,
      message: {
        role: 'user',
        parts: [{ type: 'text', text: prompt }]
      }
    }
  })

  refreshNuxtData('chats')
  navigateTo(`/chat/${chat?.id}`)
}

async function onSubmit() {
  await createChat(input.value)
}
</script>

<template>
  <UDashboardPanel
    id="home"
    class="min-h-0"
    :ui="{ body: 'p-0 sm:p-0' }"
  >
    <template #header>
      <Navbar />
    </template>

    <template #body>
      <UContainer class="flex-1 flex flex-col justify-center gap-4 sm:gap-6 py-8">
        <h1 class="text-3xl sm:text-4xl text-highlighted font-bold">
          {{ greeting }}
        </h1>

        <UChatPrompt
          v-model="input"
          placeholder="请输入你的消息..."
          :status="loading ? 'streaming' : 'ready'"
          class="[view-transition-name:chat-prompt]"
          variant="subtle"
          :ui="{ base: 'px-1.5' }"
          @submit="onSubmit"
        >
          <template #footer>
            <UChatPromptSubmit color="neutral" size="sm" />
          </template>
        </UChatPrompt>
      </UContainer>
    </template>
  </UDashboardPanel>
</template>
