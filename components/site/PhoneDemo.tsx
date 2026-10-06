'use client'

import { useRef, useState, useSyncExternalStore } from 'react'

const subscribeNothing = () => () => {}

export interface DemoStep { id: string; num: string; title: string; desc: string }

/**
 * Phone frame with a step list. Every screen is in the server-rendered HTML; JS only
 * switches which one is visible. Without JS the screens simply stack, all readable.
 */
export default function PhoneDemo({ steps, screens }: { steps: DemoStep[]; screens: React.ReactNode[] }) {
  const [active, setActive] = useState(0)
  // false while rendering on the server (and before hydration), true in the browser:
  // the screens only start stacking once JS is running.
  const live = useSyncExternalStore(subscribeNothing, () => true, () => false)
  const stageRef = useRef<HTMLDivElement>(null)

  function select(index: number) {
    setActive(index)
    // On phones the step list sits above the frame: bring the frame into view so the change is seen.
    if (window.matchMedia('(max-width: 767px)').matches) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      stageRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
    }
  }

  return (
    <div className={`demo${live ? ' is-live' : ''}`}>
      <div className="demo__steps" role="group" aria-label="一天怎么用，选一步看对应的界面">
        {steps.map((step, index) => (
          <button
            key={step.id}
            type="button"
            className="step"
            aria-current={index === active}
            aria-controls={`screen-${step.id}`}
            onClick={() => select(index)}
          >
            <span className="step__num">{step.num}</span>
            <span className="step__title">{step.title}</span>
            <span className="step__desc">{step.desc}</span>
          </button>
        ))}
      </div>
      <div className="demo__stage" ref={stageRef}>
        <div className="phone">
          <div className="phone__screen">
            {screens.map((screen, index) => (
              <div
                key={steps[index].id}
                id={`screen-${steps[index].id}`}
                className={`screen${live && index === active ? ' is-on' : ''}`}
                aria-hidden={live && index !== active ? true : undefined}
              >
                {screen}
              </div>
            ))}
          </div>
        </div>
        <p className="demo__hint">界面里的数字、食物和动作都是演示数据。</p>
      </div>
    </div>
  )
}
