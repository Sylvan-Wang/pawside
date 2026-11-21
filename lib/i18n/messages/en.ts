import type { Messages } from './zh'

// 英文字典：类型上必须和中文 key 完全一致，少一条 tsc 就报错。
export const en: Messages = {
  common: {
    nav: {
      home: 'Home',
      history: 'History',
      weekly: 'Weekly',
      settings: 'Settings',
    },
    language: {
      title: 'Language',
      zh: '中文',
      en: 'English',
      note: 'English is a work in progress: some screens are still in Chinese, and coach replies and AI feedback are Chinese only.',
    },
  },
}
