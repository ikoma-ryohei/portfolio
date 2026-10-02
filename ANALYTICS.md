# Google Analytics 4 の設定

全6ページが共通の `analytics.js` を読み込みます。

## 計測の開始

1. Google Analytics でプロパティを作成し、公開サイトの URL を指定して「ウェブ」のデータストリームを作成します。
2. 「管理 → データ ストリーム → 対象のウェブストリーム」で `G-` から始まる測定 ID をコピーします。
3. `analytics.js` の `const measurementId = "";` に測定 ID を設定します。
4. 変更したファイルを公開サイトにデプロイします。

測定 ID が空または不正な場合、Google のスクリプトを読み込まず、計測しません。測定 ID は公開用の識別子で、秘密鍵ではありません。

`localhost`、`127.0.0.1`、`[::1]`、`file://` では計測しません。本番サイトのアクセスはページ読み込みごとに GA4 の `page_view` として計測されます。追加の手動 `page_view` は送信していません。

## 公開後の確認

1. 公開サイトを開き、トップページとカードページを移動します。
2. Google Analytics の「リアルタイム」レポートでアクセスが表示されることを確認します。
3. ブラウザの開発者ツールの Network で `gtag/js?id=G-…` と `google-analytics.com/g/collect` などへのリクエストを確認します。広告ブロッカーなどにより通信が遮断される場合があります。

公式ドキュメント:
- [ウェブサイトへの導入](https://developers.google.com/analytics/devguides/collection/ga4/web?hl=ja)
- [ページビューの計測](https://developers.google.com/analytics/devguides/collection/ga4/views?hl=ja)
