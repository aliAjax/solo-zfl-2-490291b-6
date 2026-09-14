# KeyFeeling

键盘手感记录与对比工具（React + TypeScript + Vite），另含**键帽团购与分期结算台**（`/groupbuy`，首页顶栏 Boxes 图标进入）。纯前端、localStorage 持久化（键 `keyfeeling-groupbuy-v1`）。

业务规则：

- **批次录入**：配色名额、阶梯单价、定金比例、尾款截止日、每单运费。
- **报名占位**：按配色占位，超额自动进候补；名额释放按候补 FIFO 顺序补位，最后一席不会被重复占用。
- **跨档调价**：锁单前改数量命中新阶梯，只调整**未结算尾款**，已收流水不重复扣减。
- **账务**：款项按交易号幂等入账（重复交易号忽略）；退款不能超过已收；存在欠款不能发货。
- **状态机**：招募 → 锁单 → 生产 → 发货 → 完成（逐级，不能越级），另可取消；锁单后不能改配色，发货后不能改地址，取消时账务与名额一致。
- **看板**：名额占用、应收、已收、欠款、退款。金额一律以「分」整数存储。

```bash
npm run dev          # 开发
npm run build        # 类型检查 + 生产构建
npm run check        # 仅类型检查
npm run test:gb      # 纯逻辑测试（跨档/补位/幂等/超额退款/越级/取消一致性 + 四个边界反例）
node scripts/e2e.mjs       # 浏览器 E2E（先 build，再 vite preview --port 5200）
node scripts/e2e-edge.mjs  # 浏览器边界反例（减量补位/全部发货才完成/改价超额拦截/并发校验）
node scripts/e2e-cancel-reprice.mjs  # 浏览器：取消订单后的改价保护
```

边界规则补充：减少数量释放名额会立即按候补顺序补位；批次必须全部正式订单发货后才能完成；最后一席并发复用报名状态与输入校验（锁单/取消/完成后一律不能新增报名）。改阶梯价或运费时，对**任何持有净付的订单（含已取消订单）**都要满足「净付 ≤ 新应收」，差额未被退款覆盖会被拦截并提示至少需先退多少；退足差额后放行，已收不重复扣减。

---

## Vite 模板说明

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default tseslint.config({
  extends: [
    // Remove ...tseslint.configs.recommended and replace with this
    ...tseslint.configs.recommendedTypeChecked,
    // Alternatively, use this for stricter rules
    ...tseslint.configs.strictTypeChecked,
    // Optionally, add this for stylistic rules
    ...tseslint.configs.stylisticTypeChecked,
  ],
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default tseslint.config({
  extends: [
    // other configs...
    // Enable lint rules for React
    reactX.configs['recommended-typescript'],
    // Enable lint rules for React DOM
    reactDom.configs.recommended,
  ],
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```
