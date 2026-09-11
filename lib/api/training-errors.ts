import { apiError } from './response'

interface DatabaseErrorLike {
  code?: string
  message?: string
}

export function trainingDatabaseError(error: DatabaseErrorLike) {
  if (error.code === '28000') return apiError('UNAUTHORIZED', '请先登录', 401)
  if (error.code === 'P0002') return apiError('NOT_FOUND', '训练记录不存在', 404)
  if (error.code === '22023') {
    const message = error.message?.includes('At least one completed set')
      ? '至少完成并保存一组后才能结束训练'
      : '训练记录参数无效'
    return apiError('VALIDATION_ERROR', message, 400)
  }
  if (error.code === '55000') return apiError('CONFLICT', '当前训练状态不允许此操作', 409)
  return apiError('DATABASE_ERROR', '暂时无法保存训练，请稍后重试', 500)
}
