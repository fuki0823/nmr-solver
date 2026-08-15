# NMR Solver

分子式とNMRデータ(¹H・¹³C・DEPT・COSY・HSQC・HMBCなど)をもとに構造式を推定し、構造エディタで描いて回答する、NMR構造解析の学習用Webアプリです。

- 分子式・¹H/¹³C NMR・DEPT・COSY・HSQC・HMBCなど、問題ごとに必要な解析法だけを表示
- ブラウザ内蔵の構造エディタ(Ketcher)で構造式を描いて回答
- 不正解時は「正解構造」を教えるのではなく、提出した構造がスペクトルデータのどこと矛盾するか(分子式・DEPTの炭素タイプ本数・COSYのスピン系の形など)を段階的にフィードバック
- ヒント(減点あり)・答えを見る(0点扱い)による学習補助

## 技術スタック

- [Next.js](https://nextjs.org/) 16 (App Router, Turbopack)
- [React](https://react.dev/) 19 / TypeScript
- [Tailwind CSS](https://tailwindcss.com/) v4
- 構造エディタ: [Ketcher](https://github.com/epam/ketcher)(`ketcher-react` + `ketcher-standalone`。Indigoエンジンをブラウザ内WASMで実行し、外部サーバー不要)
- アクセス解析: [Vercel Analytics](https://vercel.com/docs/analytics)(任意・Vercel環境でのみ動作)

サーバーサイドAPIやデータベースは使用していません。問題データは `src/data/questions.ts` に静的に保持しており、正誤判定・スペクトル矛盾検出はすべてブラウザ内(クライアントサイド)で完結します。

## ローカルでの起動

```bash
npm install
npm run dev
```

[http://localhost:3000](http://localhost:3000) を開いてください。

## ビルド・チェック

```bash
npm run lint       # ESLint
npx tsc --noEmit   # 型チェック
npm run build      # 本番ビルド
npm run start      # 本番ビルドをローカルで起動
npm run validate   # 問題データ(questions.ts)の構造的な整合性チェック
```

`npm run validate` は id重複・必須フィールドの欠落・`methods`フィールドと実データの不整合など、機械的に検出できる問題のみをチェックします。NMR相関(COSY/HSQC/HMBCなど)の化学的な妥当性そのものは検証しないため、新しい問題を追加した際は内容を必ず目視で確認してください。

## 環境変数

すべて任意です。未設定でもローカル・Vercelどちらでも動作します。

| 変数名 | 用途 | 設定場所の目安 |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | OGP・canonical URL・sitemap.xml に使う公開URL(例: `https://your-app.vercel.app`) | Production(・Preview) |

`NEXT_PUBLIC_` 接頭辞のためブラウザに公開される値です。秘密情報は含めないでください。このアプリは他に秘密情報(APIキー等)を必要としません。

Vercel Analyticsは追加の環境変数設定なしに、Vercelへのデプロイ後、Vercelダッシュボードの該当プロジェクトで機能を有効化するだけで計測が始まります(ローカル・他ホスティングでは計測スクリプトが読み込まれず何も送信されません)。送信しているカスタムイベントは `problem_start` / `answer_submitted` / `problem_completed` のみで、問題番号・難易度・正誤・使用ヒント数といった非個人情報に限定しています(ユーザーが描いた構造そのものなどは送信していません)。

## Vercelへのデプロイ

1. GitHubなどにこのリポジトリをpushする
2. [Vercel](https://vercel.com/new) で当該リポジトリをインポート(Next.jsプロジェクトとして自動検出されます。追加設定は不要です)
3. 必要であれば環境変数 `NEXT_PUBLIC_SITE_URL` にデプロイ後の公開URLを設定
4. デプロイ後、Vercelダッシュボードの Analytics タブで Vercel Analytics を有効化(任意)

`vercel.json` は用意していません(標準的なNext.jsプロジェクトとして特別な設定なしにデプロイできるため)。

## 問題データの追加方法

`src/data/questions.ts` の `questions` 配列に、`src/lib/types.ts` の `Question` 型に従ったオブジェクトを追加します。

- `id` は重複しない整数
- `difficulty` は `"easy" | "medium" | "hard" | "expert"`
- `dept` / `cosy` / `hsqc` / `hmbc` は、その問題でその解析法を使う場合のみ設定(未設定のセクションは画面に表示されません)
- `methods` を明示的に指定すると問題一覧のバッジ表示に使われます(省略した場合は他のフィールドの有無から自動推定されます)
- `molecularWeight` を設定すると、分子式の代わりに分子量(・`exactMass`があれば精密質量)を画面に表示します(天然物レベルの問題で、分子式からの逆算を防ぐために使用)
- 追加後は `npm run validate` を実行し、`npm run build` で表示崩れがないか確認してください

## 既知の制約

- 不正解時の矛盾検出は、分子式/分子量・DEPTの炭素タイプ本数・COSYのスピン系の形など、原子同士の対応付け(atom mapping)を必要としない範囲に限定しています。HMBCの特定の1本の相関(例: 「H-12→C-7が説明できない」)のような、原子レベルでの指摘には対応していません(一般的な部分構造マッチングが必要な難所のため)。
- 問題データ(正解構造・解説を含む)はクライアントサイドの静的データとして配信されるため、ページのソースを閲覧すれば正解を確認できてしまいます。本アプリは学習用ツールであり厳密な試験システムではないため、現状は許容していますが、これを避けたい場合は正解判定をサーバーサイドに移す設計変更が必要です。
