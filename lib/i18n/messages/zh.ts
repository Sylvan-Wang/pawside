// 中文字典：现有界面上的原文，原样搬进来。中文界面以它为准，改这里就是改线上中文文案。
// 分组照 docs/i18n/batch1-strings.md 第 6 节：common（共用组件、lib 文案）、home、today、session、food。
// 已搬：底部导航、语言设置、首页（含首页上的教练卡片、新手导览、训练日名、营养行名）。
// 其余页面在批 1 后续 PR 里逐页搬。

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
    // components/CoachCard.tsx 的默认文案（首页、历史、训练、饮食共用）
    coachCard: {
      loading: '教练反馈生成中…',
      insufficient: '还没有记录，记一点什么，教练才能给出反馈。',
      basic: '基础总结 · AI 反馈暂时没有生成',
      retry: '重试',
      retrying: '重试中…',
    },
    // lib/split-labels.ts 的兜底训练日名
    splits: {
      push: '推',
      pull: '拉',
      legs: '腿',
      chest: '胸',
      back: '背',
      shoulders: '肩',
      core: '腹肌',
      glute_leg_base: '臀腿基础',
      upper_base: '上肢基础',
      comfort_cardio: '舒适有氧',
      glute_leg_extra: '臀腿补充',
      upper_core: '上肢与核心',
      fallback: '训练',
    },
    // lib/nutrition/daily-log.ts toDashboardNutrition 的行名（按 key 取）
    nutrients: {
      calories: '热量',
      protein: '蛋白质',
      carbs: '碳水',
      fat: '脂肪',
    },
    // components/AppTour.tsx；steps 必须和 lib/tour/steps.ts 逐字一致（测试会对）
    tour: {
      ariaLabel: '新手导览',
      whatsNew: '有新东西 · ',
      skip: '跳过',
      prev: '上一步',
      next: '下一步',
      done: '开始使用',
      steps: {
        hello: {
          title: '你好，我是爪边的小猫',
          body: '接下来用不到一分钟，带你过一遍最常用的几个地方。随时可以跳过，也能在「设置」里重看。',
        },
        today: {
          title: '今天练什么',
          body: '首页点「开始训练」，就能看到今天的部位、动作和每组目标。只有 30 分钟？在训练页可以先选短版。',
          hrefLabel: '去看今天的训练',
        },
        log: {
          title: '做完一组，点一下',
          body: '逐组记录重量和次数。中途退出也没关系，回来会接着上次停下的地方。',
        },
        food: {
          title: '吃了什么，写下来',
          body: '手动记录每餐，系统估算热量和蛋白质，给出当天的参考范围。',
          hrefLabel: '去记一餐',
        },
        review: {
          title: '练完吃完，都有反馈',
          body: '每次训练、每天、每周都有一段文字反馈。「历史」看过往记录，「周报」看这一周的整体情况。',
          hrefLabel: '看周报',
        },
        rest: {
          title: '休息不算掉队',
          body: '首页显示「本周训练 x/y 次」，目标可以在设置里改。按自己的节奏来，休息日不会被记成失败。',
        },
      },
    },
  },
  // app/home/page.tsx
  home: {
    brand: '爪边',
    loading: '读取中…',
    startToday: '开始今天',
    logWorkout: '记录训练',
    finishSetup: '完成基础设置',
    logFood: '记录饮食',
    method: {
      label: '训练方法',
      defaultName: '官方三分化',
      cycle: '{name} · 第 {n} 轮',
      next: '下一次：{split}',
      orderNote: '训练顺序按方法推进，休息不会跳过下一练。',
      pendingMessage: '官方训练方法仍在规则校验中。',
      loadFailed: '暂时无法读取官方训练方法状态。',
      enableFailed: '暂时无法启用训练方法',
      enableFailedRetry: '暂时无法启用训练方法，请稍后重试。',
      enabledNotice: '三分化已启用。',
      reading: '正在读取训练方法',
      ready: '官方三分化已准备好',
      pickOne: '选一个适合你的训练方法',
      notOpen: '官方三分化尚未开放',
      syncing: '正在同步你的训练状态…',
      enabling: '正在启用…',
      choose: '选择训练方法',
      enable: '启用训练方法',
      view: '查看训练方法',
      preview: '预览方法',
    },
    cards: {
      todayTraining: '今日训练进度',
      doneTimes: '已完成 {n} 次',
      notDone: '未完成',
      listSeparator: '、',
      todayFood: '今日饮食进度',
      mealsLogged: '已记录 {n} 餐',
      notLogged: '未记录',
      week: '本周训练',
      weekCount: '{done} 次',
      weekCountOfTarget: '{done} / {target} 次',
      setWeeklyTarget: '设置每周训练目标',
      weekTargetNote: '目标仅供参考，休息日可以按需安排',
    },
    nutrition: {
      title: '今日营养',
      expand: '展开',
      emptyTitle: '今天还没有饮食记录',
      emptyHint: '吃完点上面的「记录饮食」，我来帮你算',
      incomplete: '资料不完整',
      noTarget: '未设目标',
      over: '已超出 {n}',
      setCalorieTarget: '设置每日热量目标',
    },
    recovery: {
      title: '今天状态怎么样？',
      intro: '每天最多问一次，可以跳过，不影响记录训练或饮食。',
      open: '记录今天的状态',
      sleep: '昨晚睡得好吗？',
      postWorkout: '上一次训练后恢复得怎么样？',
      saving: '保存中…',
      done: '完成',
      skip: '跳过',
      note: '这只是你的主观感受，不会自动改变训练安排。',
      saveFailed: '保存失败',
    },
    review: {
      title: '今日复盘',
      details: '查看详情',
      loading: 'AI 分析中…',
      empty: '暂无数据，去记录今天的第一条吧～',
    },
    weight: {
      title: '体重趋势',
      empty: '暂无数据',
      log: '记录身体数据',
    },
    quick: {
      title: '快捷入口',
      freeWorkout: '记录自由训练',
      food: '记录饮食',
      body: '记录身体',
    },
  },
} as const

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> }

/** 字典的形状：所有语言必须有和中文完全相同的 key。 */
export type Messages = Widen<typeof zh>
