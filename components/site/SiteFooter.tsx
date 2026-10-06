import Link from 'next/link'
import { CONTACT_EMAIL, UPDATED_YEAR } from '@/lib/site/content'
import { PawMark } from './illustrations'

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="site-footer__grid">
          <div>
            <Link href="/welcome" className="brand">
              <span className="brand__mark"><PawMark size={20} /></span>
              爪边 Pawside
            </Link>
            <p className="muted small" style={{ marginTop: 12, maxWidth: 360 }}>
              给没有私教的你：今天练什么，打开就知道。目前是内测阶段。
            </p>
          </div>
          <ul>
            <li><Link href="/welcome/method">训练方法</Link></li>
            <li><Link href="/welcome/roadmap">路线图</Link></li>
            <li><Link href="/privacy">隐私政策</Link></li>
            <li><Link href="/terms">服务条款</Link></li>
            <li><a href={`mailto:${CONTACT_EMAIL}`}>联系我们：{CONTACT_EMAIL}</a></li>
          </ul>
        </div>
        <p className="disclaimer">
          本网站与爪边应用里的内容仅供参考，不是医疗建议，也不能替代医生、康复师或专业教练的判断。训练方法基于公开的训练思路整理。
        </p>
        <p className="disclaimer" style={{ marginTop: 8 }}>© {UPDATED_YEAR} 爪边 Pawside</p>
      </div>
    </footer>
  )
}
