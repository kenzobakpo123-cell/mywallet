-- Docker/ produksi: simpan hash refresh token sebelumnya supaya replay dapat
-- dideteksi setelah rotasi token.
ALTER TABLE `Session`
  ADD COLUMN `previousTokenHash` VARCHAR(64) NULL;

CREATE UNIQUE INDEX `Session_previousTokenHash_key` ON `Session`(`previousTokenHash`);
