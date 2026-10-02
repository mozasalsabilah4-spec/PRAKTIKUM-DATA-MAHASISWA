// Bank lima tugas P05 · Manipulasi Data (INSERT, UPDATE, DELETE).
// Setiap tugas: CONTOH DIBEDAH -> STIMULUS (dinilai engine lokal, seluruh kasus wajib lulus) -> TUGAS LIVE MySQL 8.4.
window.P05_TASKS = [
  {
    id: "P05-T01",
    topic: "INSERT, AUTO_INCREMENT, DEFAULT",
    title: "Menambah data multi-row dengan kolom eksplisit",
    anchors: ["teori-insert", "teori-default", "teori-fungsi-dml"],
    example: {
      caseName: "Rak perpustakaan prodi",
      scenario: "Petugas menambah tiga rak. Nomor rak dibuat otomatis oleh AUTO_INCREMENT dan lokasi yang tidak disebut memakai nilai DEFAULT 'Lantai 1'.",
      setup: "CREATE TABLE rak_buku (\n  rak_id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,\n  kode VARCHAR(8) NOT NULL UNIQUE,\n  lokasi VARCHAR(40) NOT NULL DEFAULT 'Lantai 1'\n);",
      sql: "INSERT INTO rak_buku (kode) VALUES ('R-A');\nINSERT INTO rak_buku (kode, lokasi) VALUES\n  ('R-B', 'Lantai 2'),\n  ('R-C', DEFAULT);\nSELECT LAST_INSERT_ID();",
      dissection: [
        "Daftar kolom eksplisit (kode) membuat perintah tetap benar walaupun urutan kolom tabel berubah; rak_id dan lokasi diisi server.",
        "INSERT multi-row menambah dua baris dalam satu pernyataan atomik: keduanya masuk atau keduanya ditolak.",
        "Kata kunci DEFAULT pada baris R-C meminta nilai bawaan kolom, bukan string 'DEFAULT'.",
        "LAST_INSERT_ID() bernilai 2, yaitu id otomatis PERTAMA dari INSERT multi-row terakhir, bukan id terbesar (3)."
      ],
      cases: [
        { label: "Skrip contoh berjalan tanpa error", expect: { ok: true } },
        { label: "Tiga rak dengan id otomatis dan lokasi DEFAULT", run: "SELECT rak_id, kode, lokasi FROM rak_buku ORDER BY rak_id", expect: { rows: [[1, "R-A", "Lantai 1"], [2, "R-B", "Lantai 2"], [3, "R-C", "Lantai 1"]] } },
        { label: "LAST_INSERT_ID() menunjuk id pertama INSERT multi-row", run: "SELECT LAST_INSERT_ID()", expect: { scalar: 2 } },
        { label: "Kode rak duplikat ditolak UNIQUE (Error 1062)", run: "INSERT INTO rak_buku (kode) VALUES ('R-A')", expect: { error: 1062 } }
      ]
    },
    stimulus: {
      caseName: "Gudang ATK kampus",
      prompt: "Perbaiki skrip. (1) Tambahkan kategori 'ATK' dan 'Minuman' dalam SATU INSERT multi-row berkolom eksplisit sehingga kategori_id dibuat AUTO_INCREMENT. (2) Tambahkan dua produk dalam SATU INSERT: BRG-101 'Notebook A5' kategori 1 harga 12000 dengan stok memakai DEFAULT; BRG-102 'Air Mineral' kategori 2 harga 5000 stok 25.",
      setup: "CREATE TABLE kategori_produk (\n  kategori_id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,\n  nama VARCHAR(40) NOT NULL UNIQUE\n);\nCREATE TABLE produk (\n  produk_id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,\n  kode VARCHAR(12) NOT NULL UNIQUE,\n  nama VARCHAR(60) NOT NULL,\n  kategori_id INT UNSIGNED NOT NULL,\n  harga DECIMAL(12,2) NOT NULL,\n  stok INT NOT NULL DEFAULT 10,\n  status ENUM('aktif','arsip') NOT NULL DEFAULT 'aktif',\n  CONSTRAINT chk_produk_harga CHECK (harga > 0),\n  CONSTRAINT fk_produk_kategori FOREIGN KEY (kategori_id) REFERENCES kategori_produk(kategori_id)\n);",
      starterSql: "INSERT INTO kategori_produk VALUES ('ATK'), ('Minuman');\nINSERT INTO produk (kode, nama, kategori_id, harga, stok) VALUES\n  ('BRG-101', 'Notebook A5', 1, 12000, 0);",
      cases: [
        { label: "Seluruh skrip berjalan tanpa error", expect: { ok: true } },
        { label: "Tepat dua kategori tersimpan", run: "SELECT COUNT(*) FROM kategori_produk", expect: { scalar: 2 } },
        { label: "Dua produk: kategori, stok DEFAULT 10, dan status DEFAULT benar", run: "SELECT kode, kategori_id, stok, status FROM produk ORDER BY produk_id", expect: { rows: [["BRG-101", 1, 10, "aktif"], ["BRG-102", 2, 25, "aktif"]] } },
        { label: "LAST_INSERT_ID() = id produk pertama dari INSERT terakhir", run: "SELECT LAST_INSERT_ID()", expect: { scalar: 1 } },
        { label: "Kode produk tetap unik (Error 1062)", run: "INSERT INTO produk (kode, nama, kategori_id, harga) VALUES ('BRG-101', 'Duplikat', 1, 1000)", expect: { error: 1062 } }
      ]
    },
    live: {
      caseName: "Kopma kampus: produk titipan baru",
      prompt: "Pada basis data praktikum_sbd_p05, tambahkan kategori baru bernama 'Kerajinan'. Simpan id kategori tersebut ke variabel sesi memakai LAST_INSERT_ID(), lalu tambahkan minimal dua produk titipan dalam satu pernyataan multi-row berkolom eksplisit. Salah satu produk wajib memakai nilai bawaan untuk stok.",
      goal: "Kategori dan produk baru tersimpan dengan id otomatis, kategori_id berasal dari variabel LAST_INSERT_ID(), dan stok DEFAULT bernilai 0.",
      verification: "Segera setelah INSERT produk jalankan SELECT ROW_COUNT(); lalu SELECT LAST_INSERT_ID(); dan SELECT produk_id, kode, kategori_id, stok, status FROM produk ORDER BY produk_id DESC LIMIT 3;",
      checkpoint: "Screenshot bukti: hasil SELECT VERSION(); (8.4.x), hasil ROW_COUNT() = jumlah baris produk baru, nilai LAST_INSERT_ID(), dan tabel produk sesudah perubahan.",
      predictionPrompt: "Sebelum menjalankan, tulis nilai ROW_COUNT() dan LAST_INSERT_ID() yang Anda perkirakan beserta alasannya.",
      placeholder: "Tulis SQL buatan Anda untuk kategori Kerajinan. Modul tidak menyediakan jawaban live."
    }
  },
  {
    id: "P05-T02",
    topic: "INSERT dan dampak constraint",
    title: "Urutan induk-anak dan pesan error constraint",
    anchors: ["teori-insert", "teori-dampak-constraint"],
    example: {
      caseName: "Anggota unit kegiatan mahasiswa",
      scenario: "UKM (induk) harus ada sebelum anggota (anak) dapat menunjuknya. Constraint server menolak data tidak sah dengan nomor error yang dapat dibaca.",
      setup: "CREATE TABLE ukm (\n  ukm_id INT PRIMARY KEY,\n  nama VARCHAR(40) NOT NULL UNIQUE\n);\nCREATE TABLE anggota_ukm (\n  anggota_id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,\n  npm CHAR(10) NOT NULL UNIQUE,\n  nama VARCHAR(60) NOT NULL,\n  ukm_id INT NOT NULL,\n  angkatan SMALLINT NOT NULL,\n  CONSTRAINT chk_angkatan CHECK (angkatan >= 2020),\n  CONSTRAINT fk_anggota_ukm FOREIGN KEY (ukm_id) REFERENCES ukm(ukm_id)\n);",
      sql: "INSERT INTO ukm (ukm_id, nama) VALUES (1, 'Paduan Suara');\nINSERT INTO anggota_ukm (npm, nama, ukm_id, angkatan)\nVALUES ('2431740001', 'Laras', 1, 2024);",
      dissection: [
        "Induk ukm diisi lebih dahulu; bila urutan dibalik, server menolak anak dengan Error 1452.",
        "npm UNIQUE mencegah satu mahasiswa terdaftar dua kali (Error 1062).",
        "CHECK (angkatan >= 2020) menolak nilai di luar aturan bisnis dengan Error 3819.",
        "Kolom NOT NULL tanpa nilai atau diisi NULL menghasilkan Error 1048 dan baris tidak disimpan."
      ],
      cases: [
        { label: "Skrip contoh berjalan tanpa error", expect: { ok: true } },
        { label: "Satu anggota tersimpan", run: "SELECT COUNT(*) FROM anggota_ukm", expect: { scalar: 1 } },
        { label: "Anak yatim ditolak FOREIGN KEY (Error 1452)", run: "INSERT INTO anggota_ukm (npm, nama, ukm_id, angkatan) VALUES ('2431740002', 'Bima', 7, 2024)", expect: { error: 1452 } },
        { label: "NPM ganda ditolak UNIQUE (Error 1062)", run: "INSERT INTO anggota_ukm (npm, nama, ukm_id, angkatan) VALUES ('2431740001', 'Laras B', 1, 2024)", expect: { error: 1062 } },
        { label: "Angkatan 2019 ditolak CHECK (Error 3819)", run: "INSERT INTO anggota_ukm (npm, nama, ukm_id, angkatan) VALUES ('2431740003', 'Tari', 1, 2019)", expect: { error: 3819 } }
      ]
    },
    stimulus: {
      caseName: "Kepegawaian kampus",
      prompt: "Skrip awal gagal karena urutan dan datanya melanggar constraint. Perbaiki: tambahkan departemen TI 'Teknologi Informasi' lebih dahulu, lalu dua pegawai dalam satu INSERT: PGW-001 'Siti Aminah' siti@kampus.ac.id gaji 5500000 dan PGW-002 'Raka Putra' raka@kampus.ac.id gaji 4750000, keduanya pada departemen_id 1.",
      setup: "CREATE TABLE departemen (\n  departemen_id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,\n  kode VARCHAR(6) NOT NULL UNIQUE,\n  nama VARCHAR(60) NOT NULL\n);\nCREATE TABLE pegawai (\n  pegawai_id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,\n  nip VARCHAR(10) NOT NULL UNIQUE,\n  nama VARCHAR(80) NOT NULL,\n  email VARCHAR(80) NOT NULL UNIQUE,\n  departemen_id INT UNSIGNED NOT NULL,\n  gaji DECIMAL(12,2) NOT NULL,\n  CONSTRAINT chk_pegawai_gaji CHECK (gaji >= 4000000),\n  CONSTRAINT fk_pegawai_departemen FOREIGN KEY (departemen_id) REFERENCES departemen(departemen_id)\n);",
      starterSql: "INSERT INTO pegawai (nip, nama, email, departemen_id, gaji) VALUES\n  ('PGW-001', 'Siti Aminah', 'siti@kampus.ac.id', 1, 5500000),\n  ('PGW-002', 'Raka Putra', 'siti@kampus.ac.id', 1, 3500000);\nINSERT INTO departemen (kode, nama) VALUES ('TI', 'Teknologi Informasi');",
      cases: [
        { label: "Seluruh skrip berjalan tanpa error", expect: { ok: true } },
        { label: "Tepat satu departemen", run: "SELECT COUNT(*) FROM departemen", expect: { scalar: 1 } },
        { label: "Dua pegawai dengan gaji sesuai brief", run: "SELECT nip, departemen_id, gaji FROM pegawai ORDER BY pegawai_id", expect: { rows: [["PGW-001", 1, 5500000], ["PGW-002", 1, 4750000]] } },
        { label: "Email ganda ditolak (Error 1062)", run: "INSERT INTO pegawai (nip, nama, email, departemen_id, gaji) VALUES ('PGW-003', 'Uji', 'siti@kampus.ac.id', 1, 5000000)", expect: { error: 1062 } },
        { label: "Gaji di bawah aturan ditolak (Error 3819)", run: "INSERT INTO pegawai (nip, nama, email, departemen_id, gaji) VALUES ('PGW-004', 'Uji', 'uji4@kampus.ac.id', 1, 3000000)", expect: { error: 3819 } },
        { label: "Departemen tidak ada ditolak (Error 1452)", run: "INSERT INTO pegawai (nip, nama, email, departemen_id, gaji) VALUES ('PGW-005', 'Uji', 'uji5@kampus.ac.id', 9, 5000000)", expect: { error: 1452 } },
        { label: "Nama NULL ditolak (Error 1048)", run: "INSERT INTO pegawai (nip, nama, email, departemen_id, gaji) VALUES ('PGW-006', NULL, 'uji6@kampus.ac.id', 1, 5000000)", expect: { error: 1048 } }
      ]
    },
    live: {
      caseName: "Kopma kampus: pesanan baru dan uji constraint",
      prompt: "Buat satu pesanan baru untuk pelanggan fiktif, lalu tambahkan dua baris detail untuk pesanan tersebut memakai id dari LAST_INSERT_ID(). Setelah data sah tersimpan, sengaja picu empat pelanggaran: produk sama dua kali pada pesanan yang sama, detail yang menunjuk pesanan tidak ada, qty nol, dan qty NULL.",
      goal: "Satu pesanan dan dua detail sah tersimpan; empat percobaan tidak sah ditolak dengan Error 1062, 1452, 3819, dan 1048 tanpa mengubah isi tabel.",
      verification: "Jalankan SELECT COUNT(*) FROM detail_pesanan; sebelum dan sesudah percobaan gagal, serta SELECT * FROM detail_pesanan WHERE pesanan_id = @pesanan_baru;",
      checkpoint: "Screenshot bukti: data sah, keempat pesan error lengkap dengan nomornya, dan hasil COUNT(*) yang tidak berubah setelah percobaan gagal.",
      predictionPrompt: "Tulis nomor error yang Anda perkirakan untuk setiap percobaan dan constraint mana yang menolaknya.",
      placeholder: "Tulis SQL buatan Anda untuk pesanan Kopma; jangan menyalin kasus kepegawaian."
    }
  },
  {
    id: "P05-T03",
    topic: "UPDATE, WHERE, AND/OR, DEFAULT",
    title: "Memperbarui baris sasaran tanpa salah kena",
    anchors: ["teori-update", "teori-default"],
    example: {
      caseName: "Nilai kuis kelas",
      scenario: "Dosen memberi tambahan lima poin untuk skor di bawah 60 pada kelas MI atau TI, lalu mengembalikan status satu nilai ke nilai bawaan.",
      setup: "CREATE TABLE nilai_kuis (\n  nilai_id INT PRIMARY KEY,\n  kelas CHAR(2) NOT NULL,\n  skor INT NOT NULL,\n  status VARCHAR(12) NOT NULL DEFAULT 'draf'\n);\nINSERT INTO nilai_kuis VALUES (1,'MI',55,'final'),(2,'MI',80,'final'),(3,'TI',50,'final'),(4,'TI',90,'draf');",
      sql: "UPDATE nilai_kuis\nSET skor = skor + 5\nWHERE (kelas = 'MI' OR kelas = 'TI') AND skor < 60;\nUPDATE nilai_kuis SET status = DEFAULT WHERE nilai_id = 1;",
      dissection: [
        "Tanda kurung membuat OR dievaluasi dulu; tanpa kurung, AND lebih kuat sehingga seluruh kelas MI ikut diubah.",
        "skor = skor + 5 memakai nilai lama pada baris yang sama; bukan menulis angka hasil hitungan manual.",
        "SET status = DEFAULT mengembalikan kolom ke nilai bawaan skema ('draf').",
        "Jika nilai baru sama dengan nilai lama, MySQL melaporkan Rows matched: 1 Changed: 0 dan ROW_COUNT() = 0."
      ],
      cases: [
        { label: "Skrip contoh berjalan tanpa error", expect: { ok: true } },
        { label: "Hanya skor < 60 yang bertambah; status baris 1 kembali DEFAULT", run: "SELECT nilai_id, skor, status FROM nilai_kuis ORDER BY nilai_id", expect: { rows: [[1, 60, "draf"], [2, 80, "final"], [3, 55, "final"], [4, 90, "draf"]] } },
        { label: "Nilai sama tidak dihitung Changed (0 baris terpengaruh)", run: "UPDATE nilai_kuis SET status = 'draf' WHERE nilai_id = 4", expect: { affected: 0 } }
      ]
    },
    stimulus: {
      caseName: "Stok toko buku dan ATK",
      prompt: "Kurangi stok 2 dan ubah status menjadi 'perlu_pesan' HANYA untuk produk kategori 'ATK' atau 'Buku' yang stoknya ≤ 10. Setelah itu kembalikan kolom catatan produk_id 3 ke nilai DEFAULT. Skrip awal salah sasaran karena prioritas AND/OR.",
      setup: "CREATE TABLE produk_stok (\n  produk_id INT PRIMARY KEY,\n  nama VARCHAR(40) NOT NULL,\n  kategori VARCHAR(20) NOT NULL,\n  stok INT NOT NULL,\n  status VARCHAR(20) NOT NULL DEFAULT 'normal',\n  catatan VARCHAR(60) NULL DEFAULT 'cek gudang',\n  CONSTRAINT chk_stok CHECK (stok >= 0)\n);\nINSERT INTO produk_stok VALUES\n  (1,'Pena','ATK',8,'normal','cek gudang'),\n  (2,'Map','ATK',15,'normal','cek gudang'),\n  (3,'Novel','Buku',4,'normal','titipan'),\n  (4,'Kopi','Minuman',3,'normal','cek gudang'),\n  (5,'Kamus','Buku',12,'normal','cek gudang');",
      starterSql: "UPDATE produk_stok\nSET stok = stok - 2, status = 'perlu_pesan'\nWHERE kategori = 'ATK' OR kategori = 'Buku' AND stok <= 10;",
      cases: [
        { label: "Seluruh skrip berjalan tanpa error", expect: { ok: true } },
        { label: "Hanya produk 1 dan 3 yang berubah", run: "SELECT produk_id, stok, status FROM produk_stok ORDER BY produk_id", expect: { rows: [[1, 6, "perlu_pesan"], [2, 15, "normal"], [3, 2, "perlu_pesan"], [4, 3, "normal"], [5, 12, "normal"]] } },
        { label: "Catatan produk 3 kembali ke DEFAULT", run: "SELECT catatan FROM produk_stok WHERE produk_id = 3", expect: { scalar: "cek gudang" } },
        { label: "Produk kategori lain tidak tersentuh", run: "SELECT COUNT(*) FROM produk_stok WHERE status = 'perlu_pesan' AND kategori = 'Minuman'", expect: { scalar: 0 } }
      ]
    },
    live: {
      caseName: "Kopma kampus: penyesuaian harga dan stok",
      prompt: "Naikkan harga 10% untuk produk kategori Minuman atau Makanan Ringan yang stoknya kurang dari 10, lalu kembalikan status produk berstatus arsip ke nilai bawaan kolom. Sebelum mengubah, jalankan SELECT dengan WHERE yang sama untuk melihat baris sasaran.",
      goal: "Hanya baris sasaran yang berubah; jumlah Rows matched dan Changed dapat dijelaskan dan cocok dengan SELECT sebelum perubahan.",
      verification: "Jalankan SELECT produk_id, kategori_id, harga, stok, status FROM produk ORDER BY produk_id; sebelum dan sesudah, lalu SELECT ROW_COUNT(); tepat setelah setiap perubahan.",
      checkpoint: "Screenshot bukti: hasil SELECT sebelum, pesan Rows matched/Changed, hasil ROW_COUNT(), dan hasil SELECT sesudah.",
      predictionPrompt: "Sebutkan produk_id yang Anda perkirakan terkena dan nilai Rows matched serta Changed sebelum menjalankan.",
      placeholder: "Tulis SQL buatan Anda untuk penyesuaian harga Kopma; kasus stok toko buku tidak sama."
    }
  },
  {
    id: "P05-T04",
    topic: "DELETE, RESTRICT, CASCADE, SET NULL",
    title: "Menghapus data dan membaca dampaknya pada tabel lain",
    anchors: ["teori-delete", "teori-dampak-constraint"],
    example: {
      caseName: "Keranjang belanja daring",
      scenario: "Keranjang kedaluwarsa dihapus. Isi keranjang ikut hilang karena CASCADE, tetapi keranjang yang sudah memiliki transaksi dilindungi RESTRICT.",
      setup: "CREATE TABLE keranjang (\n  keranjang_id INT PRIMARY KEY,\n  pemilik VARCHAR(30) NOT NULL,\n  kedaluwarsa TINYINT NOT NULL DEFAULT 0\n);\nCREATE TABLE isi_keranjang (\n  isi_id INT PRIMARY KEY,\n  keranjang_id INT NOT NULL,\n  barang VARCHAR(30) NOT NULL,\n  CONSTRAINT fk_isi_keranjang FOREIGN KEY (keranjang_id) REFERENCES keranjang(keranjang_id) ON DELETE CASCADE\n);\nCREATE TABLE transaksi_keranjang (\n  trx_id INT PRIMARY KEY,\n  keranjang_id INT NOT NULL,\n  CONSTRAINT fk_trx_keranjang FOREIGN KEY (keranjang_id) REFERENCES keranjang(keranjang_id) ON DELETE RESTRICT\n);\nINSERT INTO keranjang VALUES (1,'Ani',1),(2,'Beni',1),(3,'Cici',0);\nINSERT INTO isi_keranjang VALUES (1,1,'Pena'),(2,1,'Map'),(3,2,'Tas'),(4,3,'Buku');\nINSERT INTO transaksi_keranjang VALUES (1,2);",
      sql: "SELECT keranjang_id FROM keranjang WHERE kedaluwarsa = 1 AND keranjang_id = 1;\nDELETE FROM keranjang WHERE kedaluwarsa = 1 AND keranjang_id = 1;",
      dissection: [
        "SELECT dengan WHERE yang sama dijalankan dulu untuk memastikan hanya keranjang 1 yang menjadi sasaran.",
        "ON DELETE CASCADE ikut menghapus dua baris isi_keranjang milik keranjang 1.",
        "Keranjang 2 juga kedaluwarsa tetapi dirujuk transaksi; ON DELETE RESTRICT menolak penghapusan dengan Error 1451.",
        "DELETE tanpa WHERE akan menghapus semua baris; biasakan menulis WHERE sebelum menulis FROM."
      ],
      cases: [
        { label: "Skrip contoh berjalan tanpa error", expect: { ok: true } },
        { label: "Keranjang 1 terhapus", run: "SELECT keranjang_id FROM keranjang ORDER BY keranjang_id", expect: { rows: [[2], [3]] } },
        { label: "Isi keranjang 1 ikut terhapus oleh CASCADE", run: "SELECT isi_id FROM isi_keranjang ORDER BY isi_id", expect: { rows: [[3], [4]] } },
        { label: "Keranjang bertransaksi dilindungi RESTRICT (Error 1451)", run: "DELETE FROM keranjang WHERE keranjang_id = 2", expect: { error: 1451 } }
      ]
    },
    stimulus: {
      caseName: "Pesanan kantin",
      prompt: "Hapus pesanan berstatus 'dibatalkan' yang totalnya 0 (detailnya harus ikut hilang lewat CASCADE, bukan dihapus manual). Kemudian hapus kategori_arsip id 1 sehingga produk_arsip yang merujuknya menjadi NULL lewat SET NULL. Skrip awal memakai OR dan tertahan RESTRICT pada tabel pembayaran.",
      setup: "CREATE TABLE kategori_arsip (\n  kategori_id INT PRIMARY KEY,\n  nama VARCHAR(30) NOT NULL\n);\nCREATE TABLE produk_arsip (\n  produk_id INT PRIMARY KEY,\n  nama VARCHAR(30) NOT NULL,\n  kategori_id INT NULL,\n  CONSTRAINT fk_arsip_kategori FOREIGN KEY (kategori_id) REFERENCES kategori_arsip(kategori_id) ON DELETE SET NULL\n);\nCREATE TABLE pesanan (\n  pesanan_id INT PRIMARY KEY,\n  pelanggan VARCHAR(40) NOT NULL,\n  status VARCHAR(12) NOT NULL,\n  total DECIMAL(12,2) NOT NULL DEFAULT 0\n);\nCREATE TABLE detail_pesanan (\n  detail_id INT PRIMARY KEY,\n  pesanan_id INT NOT NULL,\n  produk VARCHAR(30) NOT NULL,\n  qty INT NOT NULL,\n  CONSTRAINT fk_detail_pesanan FOREIGN KEY (pesanan_id) REFERENCES pesanan(pesanan_id) ON DELETE CASCADE\n);\nCREATE TABLE pembayaran (\n  bayar_id INT PRIMARY KEY,\n  pesanan_id INT NOT NULL,\n  CONSTRAINT fk_bayar_pesanan FOREIGN KEY (pesanan_id) REFERENCES pesanan(pesanan_id) ON DELETE RESTRICT\n);\nINSERT INTO kategori_arsip VALUES (1,'Musiman'),(2,'Reguler');\nINSERT INTO produk_arsip VALUES (1,'Payung',1),(2,'Jas hujan',1),(3,'Pena',2);\nINSERT INTO pesanan VALUES (1,'Andi','dibatalkan',0),(2,'Budi','dibatalkan',45000),(3,'Citra','selesai',0),(4,'Dewi','dibatalkan',0);\nINSERT INTO detail_pesanan VALUES (1,1,'Pena',2),(2,2,'Map',1),(3,4,'Buku',1),(4,3,'Kopi',3);\nINSERT INTO pembayaran VALUES (1,3);",
      starterSql: "DELETE FROM pesanan WHERE status = 'dibatalkan' OR total = 0;\nDELETE FROM kategori_arsip WHERE kategori_id = 2;",
      cases: [
        { label: "Seluruh skrip berjalan tanpa error", expect: { ok: true } },
        { label: "Hanya pesanan 1 dan 4 yang terhapus", run: "SELECT pesanan_id FROM pesanan ORDER BY pesanan_id", expect: { rows: [[2], [3]] } },
        { label: "Detail pesanan 1 dan 4 ikut terhapus (CASCADE)", run: "SELECT detail_id FROM detail_pesanan ORDER BY detail_id", expect: { rows: [[2], [4]] } },
        { label: "Produk kategori 1 menjadi NULL (SET NULL)", run: "SELECT produk_id, kategori_id FROM produk_arsip ORDER BY produk_id", expect: { rows: [[1, null], [2, null], [3, 2]] } },
        { label: "Pesanan yang sudah dibayar tetap dilindungi (Error 1451)", run: "DELETE FROM pesanan WHERE pesanan_id = 3", expect: { error: 1451 } }
      ]
    },
    live: {
      caseName: "Kopma kampus: bersih-bersih pesanan batal",
      prompt: "Hapus pesanan berstatus dibatalkan dan amati detailnya ikut terhapus. Lalu coba hapus satu produk yang masih tercatat pada detail pesanan aktif, dan terakhir hapus kategori Suvenir. Selalu jalankan SELECT dengan WHERE yang sama sebelum menghapus.",
      goal: "Pesanan batal dan detailnya hilang (CASCADE), produk yang dirujuk tertahan Error 1451 (RESTRICT), dan produk kategori Suvenir tetap ada dengan kategori_id NULL (SET NULL).",
      verification: "Jalankan SELECT COUNT(*) FROM pesanan; SELECT COUNT(*) FROM detail_pesanan; dan SELECT produk_id, kategori_id FROM produk WHERE kategori_id IS NULL; sebelum dan sesudah.",
      checkpoint: "Screenshot bukti: jumlah baris sebelum-sesudah, hasil ROW_COUNT() setelah penghapusan, pesan Error 1451 lengkap, dan produk dengan kategori_id NULL.",
      predictionPrompt: "Perkirakan berapa baris pesanan dan detail yang hilang, serta tindakan referensial mana yang bekerja pada setiap langkah.",
      placeholder: "Tulis SQL buatan Anda untuk pembersihan data Kopma."
    }
  },
  {
    id: "P05-T05",
    topic: "Transaksi atomik, COMMIT, ROLLBACK",
    title: "Menggabungkan INSERT, UPDATE, DELETE menjadi satu unit kerja",
    anchors: ["teori-fungsi-dml", "teori-dampak-constraint", "teori-update"],
    example: {
      caseName: "Kas praktikum kelas",
      scenario: "Pemindahan kas dijalankan dalam transaksi. Setelah COMMIT perubahan menetap; percobaan kedua dibatalkan dengan ROLLBACK.",
      setup: "CREATE TABLE kas (\n  kas_id INT PRIMARY KEY,\n  nama VARCHAR(30) NOT NULL,\n  saldo INT NOT NULL,\n  CONSTRAINT chk_kas_saldo CHECK (saldo >= 0)\n);\nINSERT INTO kas VALUES (1,'Kas kelas',500000),(2,'Kas lab',100000);",
      sql: "START TRANSACTION;\nUPDATE kas SET saldo = saldo - 50000 WHERE kas_id = 1;\nUPDATE kas SET saldo = saldo + 50000 WHERE kas_id = 2;\nCOMMIT;\nSTART TRANSACTION;\nDELETE FROM kas;\nROLLBACK;",
      dissection: [
        "START TRANSACTION membuka unit kerja; kedua UPDATE menjadi satu kesatuan yang atomik.",
        "COMMIT menetapkan perubahan sehingga saldo 450000 dan 150000 bertahan.",
        "DELETE FROM kas tanpa WHERE di transaksi kedua dibatalkan oleh ROLLBACK; tidak ada baris yang hilang.",
        "CHECK (saldo >= 0) tetap menjaga data: pengurangan melebihi saldo ditolak Error 3819."
      ],
      cases: [
        { label: "Skrip contoh berjalan tanpa error", expect: { ok: true } },
        { label: "Saldo setelah COMMIT dan ROLLBACK benar", run: "SELECT kas_id, saldo FROM kas ORDER BY kas_id", expect: { rows: [[1, 450000], [2, 150000]] } },
        { label: "Saldo negatif ditolak CHECK (Error 3819)", run: "UPDATE kas SET saldo = saldo - 999999 WHERE kas_id = 2", expect: { error: 3819 } }
      ]
    },
    stimulus: {
      caseName: "Koperasi simpan pinjam",
      prompt: "Pindahkan 150000 dari akun 1 ke akun 2 sebagai SATU transaksi: catat mutasi (keterangan 'Pembayaran INV-2026-017'), kurangi saldo pengirim, tambah saldo penerima, hapus antrean 99, lalu COMMIT. Setelah itu uji perintah berbahaya UPDATE akun SET saldo = 0 di dalam transaksi baru dan batalkan dengan ROLLBACK. Skrip awal lupa membuka transaksi.",
      setup: "CREATE TABLE akun (\n  akun_id INT PRIMARY KEY,\n  pemilik VARCHAR(40) NOT NULL,\n  saldo DECIMAL(14,2) NOT NULL,\n  CONSTRAINT chk_saldo CHECK (saldo >= 0)\n);\nCREATE TABLE mutasi (\n  mutasi_id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,\n  dari_akun INT NOT NULL,\n  ke_akun INT NOT NULL,\n  nominal DECIMAL(14,2) NOT NULL,\n  keterangan VARCHAR(60) NOT NULL,\n  dibuat DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  CONSTRAINT chk_nominal CHECK (nominal > 0),\n  CONSTRAINT fk_mutasi_dari FOREIGN KEY (dari_akun) REFERENCES akun(akun_id),\n  CONSTRAINT fk_mutasi_ke FOREIGN KEY (ke_akun) REFERENCES akun(akun_id)\n);\nCREATE TABLE antrean_mutasi (\n  antrean_id INT PRIMARY KEY,\n  keterangan VARCHAR(60) NOT NULL\n);\nINSERT INTO akun VALUES (1,'Koperasi',1000000),(2,'Toko Buku',200000);\nINSERT INTO antrean_mutasi VALUES (98,'Pembayaran INV-2026-016'),(99,'Pembayaran INV-2026-017');",
      starterSql: "INSERT INTO mutasi (dari_akun, ke_akun, nominal, keterangan) VALUES (1, 2, 150000, 'Pembayaran INV-2026-017');\nUPDATE akun SET saldo = saldo - 150000 WHERE akun_id = 1;\nUPDATE akun SET saldo = saldo + 150000 WHERE akun_id = 2;\nDELETE FROM antrean_mutasi WHERE antrean_id = 99;\nUPDATE akun SET saldo = 0;\nROLLBACK;",
      cases: [
        { label: "Seluruh skrip berjalan tanpa error", expect: { ok: true } },
        { label: "Saldo akhir 850000 dan 350000 (ROLLBACK menyelamatkan saldo)", run: "SELECT akun_id, saldo FROM akun ORDER BY akun_id", expect: { rows: [[1, 850000], [2, 350000]] } },
        { label: "Tepat satu mutasi 150000 tercatat", run: "SELECT COUNT(*) FROM mutasi WHERE dari_akun = 1 AND ke_akun = 2 AND nominal = 150000", expect: { scalar: 1 } },
        { label: "Antrean 99 terhapus, antrean 98 tetap", run: "SELECT antrean_id FROM antrean_mutasi ORDER BY antrean_id", expect: { rows: [[98]] } },
        { label: "Penarikan melebihi saldo ditolak (Error 3819)", run: "UPDATE akun SET saldo = saldo - 5000000 WHERE akun_id = 1", expect: { error: 3819 } }
      ]
    },
    live: {
      caseName: "Kopma kampus: pembayaran pesanan atomik",
      prompt: "Proses pembayaran pesanan Citra sebagai satu transaksi: ubah status pesanan menjadi dibayar, kurangi stok setiap produk sesuai detailnya, dan catat baris sebelum-sesudah pada arsip_uji, lalu COMMIT. Setelah itu buka transaksi kedua, lakukan perubahan uji yang merusak (misalnya mengosongkan stok semua produk), periksa hasilnya, lalu batalkan dengan ROLLBACK.",
      goal: "Perubahan transaksi pertama menetap setelah COMMIT; perubahan transaksi kedua hilang seluruhnya setelah ROLLBACK; tidak ada stok negatif.",
      verification: "Jalankan SELECT pesanan_id, status FROM pesanan; SELECT produk_id, stok FROM produk ORDER BY produk_id; dan SELECT * FROM arsip_uji; sebelum COMMIT, sesudah COMMIT, di dalam transaksi kedua, dan sesudah ROLLBACK.",
      checkpoint: "Screenshot bukti: START TRANSACTION, hasil di tengah transaksi, hasil setelah COMMIT, serta hasil setelah ROLLBACK yang kembali ke keadaan sebelumnya.",
      predictionPrompt: "Tulis keadaan stok produk yang Anda perkirakan setelah COMMIT dan setelah ROLLBACK, serta alasan transaksi harus atomik.",
      placeholder: "Tulis SQL transaksi buatan Anda untuk pembayaran Kopma."
    }
  }
];
