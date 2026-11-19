-- Preferensi pengguna
ALTER TABLE `User`
  ADD COLUMN `timezone` VARCHAR(191) NOT NULL DEFAULT 'UTC',
  ADD COLUMN `currency` VARCHAR(191) NOT NULL DEFAULT 'IDR';

-- Tanggal kalender tersimpan eksplisit supaya tidak bergeser saat zona waktu diganti.
ALTER TABLE `Transaction` ADD COLUMN `dateKey` VARCHAR(10) NULL;
UPDATE `Transaction` SET `dateKey` = DATE_FORMAT(`date`, '%Y-%m-%d') WHERE `dateKey` IS NULL;
ALTER TABLE `Transaction` MODIFY COLUMN `dateKey` VARCHAR(10) NOT NULL;

CREATE INDEX `Transaction_userId_dateKey_date_idx` ON `Transaction`(`userId`, `dateKey`, `date`);
