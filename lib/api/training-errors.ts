import { apiError } from './response'

interface DatabaseErrorLike {
  code?: string
  message?: string
}

export function trainingDatabaseError(error: DatabaseErrorLike) {
  if (error.code === '28000') return apiError('UNAUTHORIZED', '请先登录', 401)
  if (error.code === 'P0002') return apiError('NOT_FOUND', '训练记录不存在', 404)
  if (error.code === '22023') {
    // Minimum P1 §13.2: never phrase this as outstanding/debt work. Reaching the
    // threshold is a floor, not an obligation to finish every prescribed exercise.
    const message = error.message?.includes('Session completion threshold not reached')
      ? '本次训练还没有达到可以结束的动作数量；已保存的记录都会保留，可以继续做也可以稍后回来'
      : error.message?.includes('At least one persisted set actual is required')
        ? '至少完成并保存一组真实训练记录后才能结束本次训练'
        : error.message?.includes('Duration can only be shortened')
          ? '训练中只能缩短本次时长，不能增加时长'
          : error.message?.includes('Duration adaptation requires a snapshotted canonical session')
            ? '这条历史或补充训练不支持修改时长，已保存记录不会受到影响'
      : error.message?.includes('Every prescribed exercise')
        ? '还有动作未完成；已保存记录会保留，可稍后回来继续训练'
        : error.message?.includes('At least one completed set')
          ? '至少完成并保存一组后才能结束训练'
          : '训练记录参数无效'
    return apiError('VALIDATION_ERROR', message, 400)
  }
  if (error.code === '55000') return apiError('CONFLICT', '当前训练状态不允许此操作', 409)
  return apiError('DATABASE_ERROR', '暂时无法保存训练，请稍后重试', 500)
}
