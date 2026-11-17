// 中文字典：现有界面上的原文，原样搬进来。中文界面以它为准，改这里就是改线上中文文案。
// 分组照 docs/i18n/batch1-strings.md 第 6 节：common（共用组件、lib 文案）、home、today、session、food。
// 本 PR 只搬了底部导航和语言设置，其余页面在批 1 后续 PR 里逐页搬。

export const zh = {
  common: {
    nav: {
      home: '首页',
      history: '历史',
      weekly: '周报',
      settings: '设置',
    },
    language: {
      title: '界面语言',
      zh: '中文',
      en: 'English',
      note: '英文界面还在做，目前只有部分页面是英文；小爪和 AI 反馈仍用中文。',
    },
  },
} as const

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> }

/** 字典的形状：所有语言必须有和中文完全相同的 key。 */
export type Messages = Widen<typeof zh>
