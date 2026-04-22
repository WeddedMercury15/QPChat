<script setup lang="ts">
const props = withDefaults(defineProps<{
  markdown: string
  streaming?: boolean
  charsPerTick?: number
  intervalMs?: number
}>(), {
  streaming: false,
  charsPerTick: 2,
  intervalMs: 20
})

const rendered = ref(props.streaming ? '' : props.markdown)
let timer: ReturnType<typeof setInterval> | null = null

function stopTimer() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function tick() {
  const currentLength = rendered.value.length
  const targetLength = props.markdown.length

  if (currentLength >= targetLength) {
    stopTimer()
    return
  }

  rendered.value = props.markdown.slice(0, currentLength + props.charsPerTick)
}

function startTypewriterIfNeeded() {
  if (!props.streaming) {
    rendered.value = props.markdown
    stopTimer()
    return
  }

  if (rendered.value.length > props.markdown.length) {
    rendered.value = props.markdown
  }

  if (!timer && rendered.value.length < props.markdown.length) {
    timer = setInterval(tick, props.intervalMs)
  }
}

watch(() => props.markdown, () => {
  startTypewriterIfNeeded()
}, { immediate: true })

watch(() => props.streaming, () => {
  startTypewriterIfNeeded()
}, { immediate: true })

onUnmounted(() => {
  stopTimer()
})
</script>

<template>
  <ChatComark :markdown="rendered" :streaming="streaming" />
</template>
