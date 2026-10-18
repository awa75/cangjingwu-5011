# 自托管字体（Noto Serif SC 子集）

按 `docs/02-视觉与主题.md` 第 4 节的决定，衬线中文字体**自托管、不依赖 CDN**。
仓库里不放字体二进制（体积大且需按需子集化），当前 `--font-serif` 的取值链是：

```
'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', 'SimSun', serif
```

桌面浏览器通常会命中 `Songti SC`（macOS）或 `SimSun`（Windows），观感已接近；手机端会退到系统衬线体。

## 需要补字体时（可选，不影响站点的其他功能）

1. 取一份 Noto Serif SC（SIL OFL 1.1）的 TTF，用 `fonttools` 做子集化：

   ```bash
   pip install fonttools brotli
   pyftsubset NotoSerifSC-Regular.ttf \
     --text-file=常用字.txt \
     --flavor=woff2 \
     --layout-features='*' \
     --output-file=NotoSerifSC-Regular.subset.woff2
   ```

   `常用字.txt` 建议放：GB2312 一级/二级汉字 + 常用标点 + 项目里出现的人名/编号字符。

2. 把产物放到本目录（`NotoSerifSC-Regular.subset.woff2`、`NotoSerifSC-SemiBold.subset.woff2`）。

3. 在 `src/design/tokens.css` 顶部加 `@font-face`：

   ```css
   @font-face {
     font-family: 'Noto Serif SC';
     src: url('../assets/fonts/NotoSerifSC-Regular.subset.woff2') format('woff2');
     font-weight: 400;
     font-display: swap;
   }
   ```

   Vite 会自动把该文件打进 `dist/assets/` 并改写 URL，生产环境仍由后端同源托管。

4. 字体文件与许可证（OFL）一并保留在本目录。
