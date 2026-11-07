# Pawside 信号采集器

参照 ai_companion_signal_agent 的采集和清洗部分改写，分析交给每日例程（见 `docs/auto-iteration/`）。

- 不需要 Reddit 账号或任何密钥：Reddit 先试公开 JSON，被拦再试 RSS；另有 App Store 竞品评论和行业新闻 RSS。
- 不调用 AI。
- 每个来源成败记在「来源健康」表里。
- 配置只改 `config/sources.yml`。

本地运行：

```bash
pip install -r tools/signals/requirements.txt
python tools/signals/collect.py --sample   # 离线自测
python tools/signals/collect.py            # 实际采集，输出到 tools/signals/out/（已忽略）
```

线上由 `.github/workflows/signals-daily.yml` 每天北京 20:00 运行，结果写到 `signals-data` 分支的 `signals/`。
