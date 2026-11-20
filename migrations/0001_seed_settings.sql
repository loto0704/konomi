-- 設定は常に1行（id = 1）。初期値は各列の DEFAULT を使う
INSERT INTO `settings` (`id`) VALUES (1) ON CONFLICT (`id`) DO NOTHING;
