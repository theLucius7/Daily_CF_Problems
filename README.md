# Lucius7 · 刷题日历

为 Lucius7 制作的 Daily_CF_Problems 刷题日历。查看每日题单、个人完成情况、题目难度、折叠提示、题解以及个人代码。

这是 `codex/lucius7-calendar` **孤立分支（orphan branch）**，从新的根提交开始，与 `main` / 上游没有共同提交历史。它只读取原仓库的公开题单作为数据，不向上游提交日历代码。原工作区的 `main` 保持不变。

## 使用

需要 Node.js 22.12+ 或 24+、Python 3.10+。

```sh
npm ci
npm run dev
```

打开 <http://127.0.0.1:4319/>。已附真实数据快照，首次启动不必访问 Codeforces。

- 月历按题单日期排列，可切换为首次个人 AC 日期；点选日期查看详情。
- 全部题目、待完成、已完成视图支持搜索题号 / 已知题名 / 日期，并组合筛选难度、状态和专题。
- 提示默认折叠，数学公式本地渲染；解题专题也在提示内，避免提前泄露思路。
- 题目、已有题解、个人代码、AC 提交都可直接打开。
- 题单难度原有的 `*` 在页面显示为 `≈`，表示估计难度。
- 手动完成记录保存在浏览器；在“数据与说明”中导出 / 导入 JSON 备份。手动完成不伪造 AC 日期。
- 热力图只统计当前题单内的首次个人 AC，不代表账号全部刷题记录。

## 数据与完成状态

`public/data/calendar.json` 来自 [Daily_CF_Problems](https://github.com/Yawn-Sean/Daily_CF_Problems) 的 `daily_problems/**/problems.md`、实际存在的题解、专题分类和 Lucius7 个人代码路径。题解链接固定到题单来源提交，缺少题解时不生成虚假链接。

`public/data/progress.json` 来自 [Codeforces user.status](https://codeforces.com/apiHelp/methods#user.status)。按稳定题目 ID 合并、分页拉取公开历史、去重提交、保留最早个人 AC。团队提交单独识别。有代码、团队 AC、尝试中均不自动视为个人完成；没有可用 API 快照时显示未知。

“未见 AC”只表示公开历史未找到个人 AC；私有 Gym、其他账号、未公开记录不在覆盖范围内。题单推荐日与实际 AC 日分开，日期统一为 Asia/Taipei（UTC+8）。重复推荐不会增加累计完成题数。

### 更新题单与提交

```sh
# 在线读取上游题单与 Codeforces 公开提交，不修改任何上游分支
npm run sync

# 或只读使用现有的本地题单仓库
npm run sync -- --source /Users/l7/programs/Daily_CF_Problems

# API 不可用时保留旧数据，并允许退出码为 0
npm run sync -- --allow-stale
```

刷新失败会保留上次成功时间和进度，附上错误状态；页面显式显示快照是否过期。浏览器“同步进度”只更新个人提交并在本地缓存，不更新题单；浏览器 CORS / 网络限制会显示失败并保留现有数据。

本项目不依赖账号凭据，不包含私有提交源代码或私人学习笔记。API 仅用于读取公开记录；手动记录不上传。

## 验证与构建

```sh
npm test
npm run build
npm run preview
```

测试覆盖团队 / 个人 AC、UTC+8 日期、重复推荐、闰年与跨年月份、组合筛选、备份验证、Markdown 中的绝对值符号、分页、缺失题解、同步失败保留快照。

构建产物在 `dist/`，使用相对资源路径，可部署到域名根路径或 GitHub Pages 子路径。该分支的 Actions 仅检查、构建并上传构建包，不修改主分支，也不自动发布网站。

若以后发布，可单独配置静态托管使用此分支与 `npm run build` / `dist`。不要直接沿用上游的强制覆盖 `gh-pages` 工作流。[GitHub 的定时工作流只在默认分支运行](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)，此独立非默认分支没有添加无法生效的定时触发器。

## 目录

```text
src/                 页面与状态逻辑
scripts/sync.py      只读题单导入与公开提交同步
public/data/         可离线查看的数据快照
tests/               数据语义与日历测试
.github/workflows/   本分支的构建检查
```
