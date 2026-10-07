import Link from 'next/link'
import { PawMark } from './illustrations'

export default function SiteHeader() {
  return (
    <header className="site-header">
      <div className="wrap site-header__inner">
        <Link href="/welcome" className="brand" aria-label="爪边 Pawside 首页">
          <span className="brand__mark"><PawMark size={20} /></span>
          爪边
        </Link>
        <nav className="nav" aria-label="主导航">
          <Link href="/welcome/method">训练方法</Link>
          <Link href="/welcome/roadmap">路线图</Link>
          <Link href="/auth" className="btn btn--ink btn--small">开始使用</Link>
        </nav>
      </div>
    </header>
  )
}
