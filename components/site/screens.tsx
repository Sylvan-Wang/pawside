/**
 * The six demo screens, drawn from the real app screens (same structure, same
 * wording where the app has fixed wording). All numbers, foods and names are demo
 * data. The cat stickers are part of the real app (components/Cat.tsx) but sit on
 * rare moments only; the everyday screens here have none, as in the app.
 *
 * Sources: app/training/today/page.tsx, app/training/sessions/[sessionId]/page.tsx,
 * app/food/FoodPageClient.tsx, app/home/page.tsx, components/CoachCard.tsx.
 */

import ExerciseFrames from './ExerciseFrames'

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
          <div className="a-day a-day--on"><small>Day 1 · 推</small><b>未开始</b></div>
          <div className="a-day"><small>Day 2 · 拉</small><b>未开始</b></div>
          <div className="a-day"><small>Day 3 · 腿</small><b>未开始</b></div>
        </div>
        <div className="a-black">
          <p className="a-xs a-on-dark" style={{ margin: 0 }}>Day 1 · 第 1 轮</p>
          <p className="a-title" style={{ margin: '4px 0 0' }}>推</p>
          <p style={{ margin: '14px 0 0', fontSize: 13, color: 'rgba(255,255,255,.8)' }}>今天大概想练多久？</p>
          <div className="a-grid a-mins">
            <div className="a-min">30</div><div className="a-min">45</div><div className="a-min a-min--on">60</div><div className="a-min">90</div>
          </div>
          <p className="a-xs" style={{ margin: '8px 0 0', color: 'rgba(255,255,255,.5)' }}>实际用时会受休息和器械等待影响。</p>
          <span className="a-btn-white">开始这个训练日</span>
        </div>
        <div className="a-card">
          <p className="a-xs a-dim" style={{ margin: 0 }}>动作 1</p>
          <p className="a-semi" style={{ margin: '2px 0 0', fontSize: 16 }}>杠铃卧推</p>
          <ExerciseFrames slug="bench-press" name="杠铃卧推" caption="Bench Press" size={96} />
          <div className="a-setrow"><span>第 1 组 · 热身</span><span className="a-grey">15 次</span></div>
          <div className="a-setrow"><span>第 2 组 · 正式</span><span className="a-grey">12 次</span></div>
          <div className="a-setrow"><span>第 3 组 · 正式</span><span className="a-grey">10 次</span></div>
          <div className="a-setrow"><span>第 4 组 · 正式</span><span className="a-grey">8 次</span></div>
        </div>
      </div>
    </div>
  )
}

/** 2. One set */
export function ScreenSet() {
  return (
    <div className="a">
      <Head title="推 · 训练中" />
      <div className="a-body">
        <div className="a-card">
          <p className="a-xs a-dim" style={{ margin: 0 }}>动作 1 / 5</p>
          <p className="a-semi" style={{ margin: '2px 0 0', fontSize: 16 }}>杠铃卧推</p>
          <ExerciseFrames slug="bench-press" name="杠铃卧推" caption="Bench Press" size={120} />
          <div className="a-setbox" style={{ marginTop: 12 }}>
            <div className="a-flex"><span className="a-semi">第 2 组 · 正式组</span><span className="a-xs" style={{ color: '#16a34a' }}>已保存</span></div>
          </div>
          <div className="a-setbox" style={{ marginTop: 10 }}>
            <div className="a-flex">
              <span className="a-semi">第 3 组 · 正式组</span>
              <span className="a-xs a-dim">待保存</span>
            </div>
            <p className="a-xs a-grey" style={{ margin: '4px 0 10px' }}>目标 10 次 · 不做到力竭</p>
            <div className="a-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
              <span className="a-field">重量 kg<span className="a-input">60</span></span>
              <span className="a-field">实际次数<span className="a-input">10</span></span>
              <span className="a-field">还能再做<span className="a-input">2</span></span>
            </div>
            <span className="a-btn-line">完成这一组</span>
          </div>
        </div>
        <div className="a-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <span className="a-day" style={{ textAlign: 'center', borderRadius: 12, padding: 10, color: '#374151', fontWeight: 500 }}>上一个动作</span>
          <span className="a-btn-black" style={{ borderRadius: 12 }}>下一个动作</span>
        </div>
      </div>
    </div>
  )
}

/** 4. Finishing a training day: the peak first, the details folded, then what is next. */
export function ScreenFinish() {
  return (
    <div className="a">
      <Head title="推 · 训练中" />
      <div className="a-body">
        <div className="a-card">
          <div style={{ textAlign: 'center' }}>
            <p className="a-semi" style={{ margin: 0, fontSize: 20 }}>杠铃卧推比上次重了</p>
            <p className="a-xs" style={{ margin: '4px 0 0', color: '#4b5563' }}>60 → 62.5 kg</p>
          </div>
          <div style={{ marginTop: 14, borderRadius: 12, background: '#f9fafb', padding: 12 }}>
            <p className="a-semi" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>推日 5 个动作都做完了，卧推最后一组是重点。</p>
            <p className="a-xs" style={{ margin: '6px 0 0', color: '#4b5563' }}>· 正式组都按目标次数完成，没有做到力竭。</p>
            <p className="a-xs a-dim" style={{ margin: '10px 0 0', background: '#fff', borderRadius: 8, padding: '6px 10px' }}>今天的数字</p>
          </div>
          <p className="a-xs" style={{ margin: '14px 0 0', textAlign: 'center', color: '#4b5563', fontSize: 13 }}>下一次：拉训练</p>
          <span className="a-btn-black" style={{ marginTop: 10 }}>看看下一次练什么</span>
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

/** 5. The evening review (home → 今日复盘) */
export function ScreenDaily() {
  return (
    <div className="a">
      <Head title="首页" />
      <div className="a-body">
        <div className="a-card">
          <div className="a-flex" style={{ marginBottom: 8 }}>
            <span className="a-semi">今日复盘</span>
            <span className="a-xs a-dim" style={{ textDecoration: 'underline' }}>查看详情</span>
          </div>
          <p className="a-semi" style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>今天推日完成了 18 组，蛋白质记录到 48g。</p>
          <p className="a-xs" style={{ margin: '6px 0 0', color: '#4b5563' }}>· 推日 19 组完成了 18 组，Y 字侧平举少做了 1 组。</p>
          <p className="a-xs" style={{ margin: '4px 0 0', color: '#4b5563' }}>· 目前记录的蛋白质离今天的参考还差一些，晚餐可以补一些。</p>
          <p className="a-xs" style={{ margin: '6px 0 0', color: '#374151' }}>→ 下一次是拉日，单手绳索下拉的最后一组是重点：10 + 5 次。</p>
        </div>
        <div className="a-card">
          <div className="a-flex"><span className="a-semi">体重趋势</span><span className="a-semi">68.4 kg</span></div>
          <div style={{ marginTop: 10, height: 54, borderRadius: 8, background: 'linear-gradient(180deg,#f9fafb,#f3f4f6)', position: 'relative' }}>
            <svg viewBox="0 0 280 54" width="100%" height="54" aria-hidden="true"><polyline points="4,16 50,22 96,20 142,30 188,28 234,36 276,34" fill="none" stroke="#000" strokeWidth="2" /></svg>
          </div>
        </div>
        <div className="a-card">
          <p className="a-semi" style={{ margin: '0 0 8px' }}>快捷入口</p>
          <div className="a-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
            <span className="a-chip" style={{ borderRadius: 12 }}>记录自由训练</span>
            <span className="a-chip" style={{ borderRadius: 12 }}>记录饮食</span>
            <span className="a-chip" style={{ borderRadius: 12 }}>记录身体</span>
          </div>
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
              <p className="a-title" style={{ margin: 0 }}>下一次：推</p>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'rgba(255,255,255,.7)' }}>训练顺序按方法推进，休息不会跳过下一练。</p>
            </div>
          </div>
          <span className="a-btn-white" style={{ marginTop: 14 }}>开始今天</span>
        </div>
        <div className="a-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="a-card"><p className="a-xs a-dim" style={{ margin: '0 0 4px' }}>今日训练进度</p><p className="a-semi a-dim" style={{ margin: 0 }}>未完成</p></div>
          <div className="a-card"><p className="a-xs a-dim" style={{ margin: '0 0 4px' }}>今日饮食进度</p><p className="a-semi a-dim" style={{ margin: 0 }}>未记录</p></div>
        </div>
        <div className="a-card">
          <div className="a-flex" style={{ marginBottom: 8 }}>
            <span className="a-semi">今日复盘</span>
            <span className="a-xs a-dim" style={{ textDecoration: 'underline' }}>查看详情</span>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: '#9ca3af' }}>暂无数据，去记录今天的第一条吧～</p>
        </div>
        <div className="a-card">
          <p className="a-semi" style={{ margin: '0 0 8px' }}>快捷入口</p>
          <div className="a-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
            <span className="a-chip" style={{ borderRadius: 12 }}>记录自由训练</span>
            <span className="a-chip" style={{ borderRadius: 12 }}>记录饮食</span>
            <span className="a-chip" style={{ borderRadius: 12 }}>记录身体</span>
          </div>
        </div>
      </div>
    </div>
  )
}
