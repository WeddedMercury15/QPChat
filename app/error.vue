<script setup lang="ts">
import type { NuxtError } from '#app'

defineProps<{
  error: NuxtError
}>()

useSeoMeta({
  title: '页面未找到',
  description: '抱歉，未找到该页面。'
})

useHead({
  htmlAttrs: {
    lang: 'zh-CN'
  }
})
</script>

<template>
  <UApp>
    <UError :error="error" />
  </UApp>
</template>
