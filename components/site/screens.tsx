/**
 * The five demo screens, drawn from the real app screens (same structure, same
 * wording where the app has fixed wording). All numbers, foods and names are demo
 * data. No artwork in here: this is the product, not decoration.
 *
 * Sources: app/training/today/page.tsx, app/training/sessions/[sessionId]/page.tsx,
 * app/food/FoodPageClient.tsx, app/home/page.tsx, components/CoachCard.tsx.
 */

function Head({ title }: { title: string }) {
  return <div className="a-head"><span>←</span>{title}</div>
}

/** 1. Today's plan */
export function ScreenPlan() {
  return (
    <div className="a">
      <Head title="训练计划" />
      <div className="a-body">
        <div className="a-grid a-days">
          <div className="a-day"><small>Day 1 · 推</small><b>已完成</b></div>
          <div className="a-day a-day--on"><small>Day 2 · 拉</small><b>未开始</b></div>
          <div className="a-day"><small>Day 3 · 腿</small><b>未开始</b></div>
        </div>
        <div className="a-black">
          <p className="a-xs a-on-dark" style={{ margin: 0 }}>Day 2 · 第 1 轮</p>
          <p className="a-title" style={{ margin: '4px 0 0' }}>拉</p>
          <p style={{ margin: '14px 0 0', fontSize: 13, color: 'rgba(255,255,255,.8)' }}>今天大概想练多久？</p>
          <div className="a-grid a-mins">
            <div className="a-min">30</div><div className="a-min">45</div><div className="a-min a-min--on">60</div><div className="a-min">90</div>
          </div>
          <p className="a-xs" style={{ margin: '8px 0 0', color: 'rgba(255,255,255,.5)' }}>实际用时会受休息和器械等待影响。</p>
          <span className="a-btn-white">开始这个训练日</span>
        </div>
        <div className="a-card">
          <p className="a-xs a-dim" style={{ margin: 0 }}>动作 1</p>
          <p className="a-semi" style={{ margin: '2px 0 0', fontSize: 16 }}>单手绳索下拉</p>
          <div style={{ marginTop: 10, borderRadius: 12, background: '#f3f4f6', height: 74, display: 'grid', placeItems: 'center' }} className="a-xs a-dim">动作示意</div>
          <div className="a-setrow"><span>第 1 组 · 热身</span><span className="a-grey">15 次</span></div>
          <div className="a-setrow"><span>第 2 组 · 正式</span><span className="a-grey">12 次</span></div>
          <div className="a-setrow"><span>第 3 组 · 正式</span><span className="a-grey">12 次</span></div>
        </div>
      </div>
    </div>
  )
}

/** 2. One set */
export function ScreenSet() {
  return (
    <div className="a">
      <Head title="拉 · 训练中" />
      <div className="a-body">
        <div className="a-card">
          <p className="a-xs a-dim" style={{ margin: 0 }}>动作 1 / 5</p>
          <p className="a-semi" style={{ margin: '2px 0 0', fontSize: 16 }}>单手绳索下拉</p>
          <div className="a-setbox" style={{ marginTop: 12 }}>
            <div className="a-flex"><span className="a-semi">第 3 组 · 正式组</span><span className="a-xs" style={{ color: '#16a34a' }}>已保存</span></div>
          </div>
          <div className="a-setbox" style={{ marginTop: 10 }}>
            <div className="a-flex">
              <span className="a-semi">第 4 组 · 休息-暂停组</span>
              <span className="a-xs a-dim">待保存</span>
            </div>
            <p className="a-xs a-semi" style={{ margin: '4px 0 10px' }}>目标 10 + 5 次 · 做到接近或到力竭</p>
            <div className="a-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
              <span className="a-field">重量 kg<span className="a-input">25</span></span>
              <span className="a-field">实际次数<span className="a-input">10</span></span>
              <span className="a-field">还能再做<span className="a-input">0</span></span>
            </div>
            <span className="a-btn-line">完成这一组</span>
          </div>
          <p className="a-semi" style={{ margin: '12px 0 0', fontSize: 13 }}>+ 记录额外一组</p>
        </div>
        <div className="a-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <span className="a-day" style={{ textAlign: 'center', borderRadius: 12, padding: 10, color: '#374151', fontWeight: 500 }}>上一个动作</span>
          <span className="a-btn-black" style={{ borderRadius: 12 }}>下一个动作</span>
        </div>
      </div>
    </div>
  )
}

/** 3. One meal */
export function ScreenMeal() {
  return (
    <div className="a">
      <Head title="记录饮食" />
      <div className="a-body">
        <div className="a-blue">
          <div className="a-flex" style={{ alignItems: 'flex-start' }}>
            <div>
              <p className="a-semi" style={{ margin: 0, fontSize: 14 }}>今日饮食参考</p>
              <p style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 600 }}>1,900 <span style={{ fontSize: 13, fontWeight: 400 }}>kcal</span></p>
            </div>
            <span className="a-xs a-grey" style={{ background: 'rgba(255,255,255,.8)', borderRadius: 999, padding: '2px 8px' }}>参考</span>
          </div>
          <div className="a-grid a-xs" style={{ gridTemplateColumns: '1fr 1fr 1fr', marginTop: 10, color: '#374151' }}>
            <span>早餐 475–570</span><span>午餐 570–760</span><span>晚餐 570–665</span>
          </div>
          <p className="a-xs a-grey" style={{ margin: '10px 0 0' }}>蛋白质 110g · 碳水 215g</p>
          <p className="a-xs a-grey" style={{ margin: '6px 0 0', fontSize: 11 }}>餐次热量仅作参考，可按作息和饥饿感调整。</p>
        </div>
        <div className="a-card">
          <p className="a-semi" style={{ margin: '0 0 8px' }}>餐别</p>
          <div className="a-chips"><span className="a-chip">早餐</span><span className="a-chip a-chip--on">午餐</span><span className="a-chip">晚餐</span><span className="a-chip">加餐</span></div>
        </div>
        <div className="a-card">
          <div className="a-flex"><span className="a-semi">食物列表</span><span className="a-semi" style={{ fontSize: 13 }}>+ 添加食物</span></div>
          <div className="a-setrow"><span>鸡腿饭</span><span className="a-grey">1 份</span></div>
          <div className="a-setrow"><span>蛋白粉</span><span className="a-grey">1 勺</span></div>
        </div>
        <div className="a-card" style={{ border: '1px dashed #e5e7eb' }}>
          <p className="a-xs a-dim" style={{ margin: 0 }}>保存前预览</p>
          <p className="a-semi" style={{ margin: '2px 0 0' }}>本餐预计加入</p>
          <p className="a-xs a-grey" style={{ margin: '6px 0 0' }}>680 kcal · 蛋白质 48g · 碳水 82g · 脂肪 16g</p>
        </div>
        <span className="a-btn-black">保存</span>
      </div>
    </div>
  )
}

/** 4. The write-up after a session */
export function ScreenReview() {
  return (
    <div className="a">
      <Head title="拉 · 训练中" />
      <div className="a-body">
        <div className="a-card">
          <p className="a-semi" style={{ margin: 0, fontSize: 16 }}>今天的训练已记录</p>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#4b5563' }}>下一次继续腿训练。</p>
          <div style={{ marginTop: 12 }} className="a-stats">
            <span>完成动作 <b>5</b></span><span>完成组数 <b>16</b></span>
            <span>训练时长 <b>52 分钟</b></span><span>训练容量 <b>6240 kg</b></span>
          </div>
          <div style={{ marginTop: 12, background: '#f9fafb', borderRadius: 12, padding: 12 }}>
            <p className="a-semi" style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>今天拉日 17 组完成了 16 组。</p>
            <p className="a-xs" style={{ margin: '6px 0 0', color: '#4b5563' }}>· 单手绳索下拉最后一组做了 10 + 4 次，目标是 10 + 5 次，差 1 次。</p>
            <p className="a-xs" style={{ margin: '4px 0 0', color: '#4b5563' }}>· 单手器械划船比上次多做了 1 次。</p>
            <p className="a-xs" style={{ margin: '6px 0 0', color: '#374151' }}>→ 下一次是腿日，现在还在找合适的重量，先把每组做稳。</p>
            <p className="a-xs a-dim" style={{ margin: '10px 0 0' }}>这次反馈有帮助吗？ 👍 👎</p>
          </div>
          <span className="a-btn-black" style={{ marginTop: 14 }}>查看训练计划</span>
        </div>
      </div>
    </div>
  )
}

/** 5. Coming back after a gap */
export function ScreenReturn() {
  return (
    <div className="a">
      <Head title="首页" />
      <div className="a-body">
        <div className="a-black" style={{ padding: 18 }}>
          <p className="a-xs a-on-dark" style={{ margin: 0 }}>官方三分化 · 第 1 轮</p>
          <div className="a-flex" style={{ marginTop: 8, alignItems: 'flex-end' }}>
            <div>
              <p className="a-title" style={{ margin: 0 }}>下一次：拉</p>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'rgba(255,255,255,.7)' }}>训练顺序按方法推进，休息不会跳过下一练。</p>
            </div>
          </div>
          <span className="a-btn-white" style={{ marginTop: 14 }}>开始今天</span>
        </div>
        <div className="a-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="a-card"><p className="a-xs a-dim" style={{ margin: '0 0 4px' }}>今日训练进度</p><p className="a-semi a-dim" style={{ margin: 0 }}>未完成</p></div>
          <div className="a-card"><p className="a-xs a-dim" style={{ margin: '0 0 4px' }}>今日饮食进度</p><p className="a-semi a-dim" style={{ margin: 0 }}>未记录</p></div>
        </div>
      </div>
    </div>
  )
}
