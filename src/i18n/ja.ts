/** 日本語の文言。キーは「場所.内容」。{name} は t() の vars で置き換える */
export const ja = {
  "command.notReady": "この操作はまだ使えません。もうしばらくお待ちください。",
  "command.usage": "使い方：`{command}` でお題をすぐに配信します（管理者のみ）。",
  "command.adminOnly": "お題の配信は管理者だけができます。",
  "command.noTopics":
    "配信できるお題がありません。管理画面でお題を追加するか、有効にしてください。",
  "command.botNotInChannel":
    "konomi がこのチャンネルに参加していないため投稿できません。チャンネルで `/invite @konomi` を実行してから、もう一度お試しください。",
  "command.botNotInTargetChannel":
    "konomi が対象チャンネル <#{channel}> に参加していないため投稿できません。そのチャンネルで `/invite @konomi` を実行してから、もう一度お試しください。",
  "command.failed": "うまく開けませんでした。少し待ってから、もう一度お試しください。",

  "delivery.modalTitle": "お題を配信する",
  "delivery.submit": "配信する",
  "delivery.cancel": "キャンセル",
  "delivery.topicLabel": "お題",
  "delivery.topicPlaceholder": "お題を選ぶ",
  "delivery.topicHint": "未使用のお題、使ってから時間がたったお題の順に並んでいます。",
  "delivery.typeNote": "配信タイプ：チャンネル型（チャンネルの誰でも回答できます）",
  "delivery.channelNote": "投稿先：<#{channel}>",
  "delivery.deadlineKindLabel": "締切",
  "delivery.deadlineAt": "日時を指定",
  "delivery.deadlineNone": "無期限（手動で終了するまで受け付ける）",
  "delivery.deadlineAtLabel": "締切の日時",
  "delivery.deadlineAtHint": "「日時を指定」を選んだときに使います。",
  "delivery.error.topicUnavailable": "このお題は配信できません。別のお題を選んでください。",
  "delivery.error.deadlineMissing": "締切の日時を入れてください。",
  "delivery.error.deadlinePast": "締切は今から5分以上あとの日時にしてください。",
  "delivery.error.unlimitedLimit":
    "受付中の無期限の配信が上限（{max}件）に達しています。どれかを終了するか、締切を指定してください。",
  "delivery.error.postFailed":
    "お題を投稿できませんでした。konomi がチャンネルに参加しているか確かめて、もう一度お試しください。",

  "round.header": "今日のお題",
  "round.deadline": "締切 {deadline}",
  "round.noDeadline": "締切なし",
  "round.answerButton": "回答する",
  "round.resultButton": "結果を見る",

  "answer.modalTitle": "お題に回答する",
  "answer.submit": "送信",
  "answer.close": "閉じる",
  "answer.choiceLabel": "1つ選んでください",
  "answer.alreadyAnswered": "回答済みです。締切までは何度でも変更できます。",
  "answer.namedNotice": "このお題は *記名* です。回答は名前付きで結果ページに表示されます。",
  "answer.adminNotice": "回答は記名で記録され、管理者は誰がどれを選んだかを確認できます。",
  "answer.thanks": "回答ありがとうございます！",
  "answer.resultLink": "<{url}|結果を見る>",
  "answer.error.choice": "選択肢から1つ選んでください。",

  "answer.rejected.notFound": "このお題は見つかりませんでした。",
  "answer.rejected.closed": "このお題の受付は終了しました。",
  "answer.rejected.optedOut": "参加しない設定になっているため回答できません。",
  "answer.rejected.excluded": "このお題には回答できません。",
  "answer.rejected.guest": "ゲストのメンバーは回答できない設定になっています。",
} as const;

export type MessageKey = keyof typeof ja;
