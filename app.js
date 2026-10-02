(() => {
  "use strict";

  const KEY = "pmi1320-week5-dml-v1";
  const LECTURER = "Muhammad Reza Redo Islami, S.Kom., M.T.I.";
  const RPS = {
    week: "5",
    cpmkCode: "CPMK-2",
    cpmk: "Mengimplementasikan skema basis data dan query SQL untuk kebutuhan sistem informasi.",
    subCode: "Sub-3",
    sub: "Mengimplementasikan query SQL untuk manipulasi, pemilihan, penggabungan, agregasi, subquery, dan view.",
    indikator: "Melakukan insert, update, delete secara aman; minimal 70% kasus uji lulus.",
    materi: "INSERT, UPDATE, DELETE; DEFAULT; LAST_INSERT_ID(); ROW_COUNT(); dampak constraint; data uji.",
    metode: "Live SQL; praktikum manipulasi data; verifikasi sebelum-sesudah.",
    waktu: "T: 1×50 menit; P: 1×170 menit; PT+KM: 1×60 menit",
    asesmen: "Praktikum manipulasi data, 5%",
    sumber: "PU-1; PU-2"
  };
  const LIVE_FIELDS = ["liveSql", "prediction", "observation", "reflection"];
  const tasks = Array.isArray(window.P05_TASKS) ? window.P05_TASKS : [];
  const lab = window.SqlLab;
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const empty = value => String(value ?? "").trim() ? esc(value) : '<span class="empty">Belum diisi</span>';
  const today = () => new Date().toISOString().slice(0, 10);
  const uid = () => globalThis.crypto?.randomUUID?.() || `img-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function blank() {
    return {
      version: 1,
      identity: { lecturer: LECTURER, reportDate: today(), aiUse: "", aiTool: "" },
      tasks: {},
      current: 0
    };
  }

  function normalizeImage(image) {
    const raw = typeof image === "string" ? { dataUrl: image, name: "Bukti lama" } : (image || {});
    const storedBytes = Number(raw.storedBytes ?? raw.bytes ?? 0);
    return {
      id: raw.id || uid(),
      dataUrl: raw.dataUrl || raw.data || "",
      name: raw.name || "Bukti praktik",
      sourceBytes: Number(raw.sourceBytes ?? storedBytes),
      storedBytes,
      width: Number(raw.width || 0),
      height: Number(raw.height || 0),
      at: raw.at || raw.savedAt || new Date().toISOString()
    };
  }

  // Menormalkan data dari localStorage atau berkas cadangan; bukti scalar lama (screenshot/imageData) dimigrasi ke images: [].
  function migrate(raw) {
    const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const data = { ...blank(), ...source };
    data.identity = source.identity && typeof source.identity === "object" ? { ...blank().identity, ...source.identity } : blank().identity;
    data.tasks = source.tasks && typeof source.tasks === "object" && !Array.isArray(source.tasks) ? source.tasks : {};
    for (const item of Object.values(data.tasks)) {
      if (!item || typeof item !== "object") continue;
      const scalar = item.screenshot || item.image || item.imageData || null;
      const list = Array.isArray(item.images) ? item.images : (scalar ? [scalar] : []);
      item.images = list.map(normalizeImage).filter(image => /^data:image\//i.test(image.dataUrl)).slice(0, 5);
      delete item.screenshot;
      delete item.image;
      delete item.imageData;
      delete item.imageMeta;
    }
    data.current = Math.max(0, Math.min(Math.max(0, tasks.length - 1), Number(data.current) || 0));
    data.version = 1;
    return data;
  }

  function safeLoad() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? migrate(JSON.parse(raw)) : blank();
    } catch (_) {
      return blank();
    }
  }

  function safeSave(candidate = state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(candidate));
      return true;
    } catch (_) {
      return false;
    }
  }

  let state = safeLoad();
  let current = state.current;
  let uploadQueue = Promise.resolve();

  function itemFor(task) {
    if (!state.tasks[task.id] || typeof state.tasks[task.id] !== "object") state.tasks[task.id] = { images: [] };
    const item = state.tasks[task.id];
    if (!Array.isArray(item.images)) item.images = [];
    return item;
  }

  const filled = value => Boolean(String(value || "").trim());
  function complete(task) {
    const item = itemFor(task);
    return item.stimulusPassed === true &&
      filled(item.liveSql) &&
      filled(item.prediction) &&
      filled(item.observation) &&
      filled(item.reflection) &&
      item.images.length >= 1;
  }
  function completedCount() { return tasks.filter(complete).length; }

  const tabButtons = Array.from(document.querySelectorAll('.tabs button[role="tab"]'));
  function openTab(id, focus = false) {
    tabButtons.forEach(button => {
      const active = button.dataset.tab === id;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
      button.tabIndex = active ? 0 : -1;
      if (active && focus) button.focus();
    });
    document.querySelectorAll("main > .tab").forEach(panel => panel.classList.toggle("active", panel.id === id));
    if (id === "rekap") { fillIdentity(); renderReport(); }
    try { window.scrollTo({top: 0, behavior: "smooth"}); } catch (_) {}
  }
  tabButtons.forEach(button => button.addEventListener("click", () => openTab(button.dataset.tab)));
  $(".tabs")?.addEventListener("keydown", event => {
    const delta = {ArrowRight:1,ArrowDown:1,ArrowLeft:-1,ArrowUp:-1}[event.key];
    const edge = {Home:0,End:tabButtons.length - 1}[event.key];
    if (!delta && edge === undefined) return;
    event.preventDefault();
    const at = Math.max(0, tabButtons.findIndex(button => button.getAttribute("aria-selected") === "true"));
    const next = edge !== undefined ? edge : (at + delta + tabButtons.length) % tabButtons.length;
    openTab(tabButtons[next].dataset.tab, true);
  });

  function buildNav() {
    $("#taskNav").innerHTML = tasks.map((task, index) => `<button type="button" class="task-link" data-index="${index}" aria-label="Buka tugas ${index + 1}: ${esc(task.topic)}"><b>${index + 1}</b><span>${esc(task.topic)}</span><i aria-hidden="true">✓</i></button>`).join("");
    $("#taskNav").addEventListener("click", event => {
      const button = event.target.closest("[data-index]");
      if (button) showTask(Number(button.dataset.index));
    });
  }

  function updateProgress() {
    const count = completedCount();
    $("#progressText").textContent = `${count}/${tasks.length}`;
    $("#progressBar").style.width = `${tasks.length ? count / tasks.length * 100 : 0}%`;
    $("#taskPosition").textContent = `Tugas ${current + 1} dari ${tasks.length}`;
    document.querySelectorAll(".task-link").forEach((button, index) => {
      button.classList.toggle("active", index === current);
      button.classList.toggle("done", complete(tasks[index]));
      button.setAttribute("aria-current", index === current ? "step" : "false");
    });
    $("#prevTask").disabled = current === 0;
    $("#nextTask").disabled = current === tasks.length - 1;
  }

  function imageCards(item) {
    if (!item.images.length) return '<p class="muted">Belum ada gambar bukti.</p>';
    return item.images.map((image, index) => `<figure class="evidence-card">
      <a href="${image.dataUrl}" target="_blank" rel="noopener" aria-label="Lihat gambar bukti ${index + 1}"><img src="${image.dataUrl}" alt="Bukti ${index + 1}: ${esc(image.name)}"></a>
      <figcaption>${index + 1}. ${esc(image.name)} · ${Math.ceil(image.storedBytes / 1024)} KB · ${image.width}×${image.height}px</figcaption>
      <button type="button" class="danger" data-remove-image-id="${esc(image.id)}">Hapus gambar ${index + 1}</button>
    </figure>`).join("");
  }

  // Log per pernyataan seperti panel hasil phpMyAdmin: pesan Query OK, Rows matched/Changed, baris SELECT, atau error.
  function scriptLog(output) {
    return output.script.results.map(result => {
      const body = result.type === "rows"
        ? `${result.columns.join(" | ")}\n${result.rows.map(row => row.map(v => v === null ? "NULL" : v).join(" | ")).join("\n")}\n${result.message}`
        : result.message;
      return `mysql> ${result.sql};\n${body}`;
    }).join("\n\n") || "(skrip kosong)";
  }

  function checkMarkup(output) {
    return output.results.map(result => `<li class="${result.pass ? "pass" : ""}">${result.pass ? "✓" : "✕"} ${esc(result.label)}${result.pass ? "" : `<small>${esc(result.detail)}</small>`}</li>`).join("");
  }

  function runStage(stage, sql) {
    try { return lab.runCases({ setup: stage.setup, sql, cases: stage.cases }); }
    catch (error) { return { passed: false, passedCount: 0, total: stage.cases.length, results: [{ label: "Engine lokal", pass: false, detail: error.message }], script: { results: [] } }; }
  }

  function stageSetup(stage, label) {
    return `<details class="setup-box"><summary>${label}</summary><pre>${esc(stage.setup)}</pre></details>`;
  }

  function showTask(index) {
    current = Math.max(0, Math.min(tasks.length - 1, Number(index) || 0));
    state.current = current;
    safeSave();
    const task = tasks[current];
    const item = itemFor(task);
    $("#taskTitle").textContent = `${current + 1}. ${task.title}`;
    $("#taskHost").innerHTML = `<article data-task="${esc(task.id)}">
      <p class="theory-anchor"><strong>Landasan teori:</strong> ${task.anchors.map(anchor => `<a href="#${esc(anchor)}" data-theory-anchor="${esc(anchor)}">${esc(anchor.replace("teori-", "").replaceAll("-", " "))}</a>`).join(" · ")}</p>
      <section class="stage"><div class="stage-head"><span>1</span><div><p>CONTOH DIBEDAH · ${esc(task.example.caseName)}</p><h3>Pelajari pola yang sudah benar</h3></div></div><p>${esc(task.example.scenario)}</p>${stageSetup(task.example, "Lihat skema awal contoh")}<textarea id="exampleSql" class="sql-editor" readonly aria-label="SQL contoh ${esc(task.topic)}">${esc(task.example.sql)}</textarea><div class="actions"><button id="checkExample" type="button">Periksa contoh</button></div><ul id="exampleResults" class="check-results"></ul><pre id="exampleLog" class="script-log" hidden></pre><p id="exampleFeedback" class="feedback" role="status">Belum diperiksa.</p><ol class="dissection">${task.example.dissection.map(line => `<li>${esc(line)}</li>`).join("")}</ol><p class="limits">Kasus contoh berbeda dari stimulus dan tugas live. Pola ini dapat dipelajari, tetapi bukan jawaban tugas live.</p></section>
      <section class="stage"><div class="stage-head"><span>2</span><div><p>STIMULUS · ${esc(task.stimulus.caseName)}</p><h3>Perbaiki lalu jalankan semua kasus uji</h3></div></div><p>${esc(task.stimulus.prompt)}</p>${stageSetup(task.stimulus, "Lihat skema dan data awal stimulus (sudah dijalankan otomatis)")}<label for="stimulusSql">SQL stimulus</label><textarea id="stimulusSql" class="sql-editor" spellcheck="false">${esc(item.stimulusSql ?? task.stimulus.starterSql)}</textarea><div class="actions"><button id="checkStimulus" class="primary" type="button">Jalankan pemeriksaan</button><button id="resetStimulus" type="button">Kembalikan stimulus</button></div><ul id="checkResults" class="check-results"></ul><pre id="stimulusLog" class="script-log" hidden></pre><p id="stimulusFeedback" class="feedback" role="status">${item.stimulusPassed ? "PASS tersimpan. Ubah SQL untuk menguji ulang." : "Belum lulus. Seluruh kasus uji wajib lulus."}</p><p class="limits">${esc(lab.LIMITATIONS)}</p></section>
      <section class="stage"><div class="stage-head"><span>3</span><div><p>TUGAS LIVE MYSQL · ${esc(task.live.caseName)}</p><h3>Prediksi, jalankan, dan verifikasi sebelum-sesudah</h3></div></div><p>${esc(task.live.prompt)}</p><p><strong>Target:</strong> ${esc(task.live.goal)}</p><p><strong>Verifikasi:</strong> <code>${esc(task.live.verification)}</code></p><p><strong>Checkpoint bukti:</strong> ${esc(task.live.checkpoint)}</p>
        <label for="prediction">Prediksi dampak sebelum eksekusi</label><textarea id="prediction" rows="3" placeholder="${esc(task.live.predictionPrompt)}">${esc(item.prediction || "")}</textarea>
        <label for="liveSql">SQL live buatan mahasiswa</label><textarea id="liveSql" class="sql-editor" spellcheck="false" placeholder="${esc(task.live.placeholder)}">${esc(item.liveSql || "")}</textarea>
        <label for="observation">Hasil verifikasi sebelum-sesudah</label><textarea id="observation" rows="4" placeholder="Salin ringkas hasil SELECT sebelum dan sesudah, pesan Rows matched/Changed, ROW_COUNT(), dan nomor error yang muncul.">${esc(item.observation || "")}</textarea>
        <label for="reflection">Refleksi</label><textarea id="reflection" rows="3" placeholder="Bandingkan prediksi dengan hasil server. Apa yang membuat perubahan aman atau berbahaya?">${esc(item.reflection || "")}</textarea>
        <label for="imageInput">Bukti gambar (1–5 screenshot)</label><input id="imageInput" type="file" multiple accept="image/*"><p class="limits">Setiap gambar dikompresi secara lokal dan ditambahkan tanpa menimpa bukti lama. Sumber maksimum 12 MB; sisi panjang maksimum 1280 px; target penyimpanan 220 KB. Jangan sertakan password.</p><div id="evidenceList" class="evidence-list">${imageCards(item)}</div><p id="imageFeedback" class="feedback" role="status"></p><div class="actions"><button id="saveLive" class="primary" type="button">Simpan tugas live</button></div><p id="liveFeedback" class="feedback" role="status"></p></section>
    </article>`;
    bindTask(task);
    updateProgress();
  }

  function showLog(id, output) {
    const log = $(id);
    log.hidden = false;
    log.textContent = scriptLog(output);
  }

  function bindTask(task) {
    const item = itemFor(task);
    $("#checkExample").addEventListener("click", () => {
      const output = runStage(task.example, task.example.sql);
      $("#exampleResults").innerHTML = checkMarkup(output);
      showLog("#exampleLog", output);
      const feedback = $("#exampleFeedback");
      feedback.className = `feedback ${output.passed ? "ok" : "bad"}`;
      feedback.textContent = output.passed ? `PASS · ${output.passedCount}/${output.total} kasus uji contoh terpenuhi.` : "Contoh paket rusak; laporkan kepada dosen.";
    });
    $("#stimulusSql").addEventListener("input", () => {
      item.stimulusSql = $("#stimulusSql").value;
      item.stimulusPassed = false;
      item.checkSummary = [];
      safeSave();
      updateProgress();
    });
    for (const id of LIVE_FIELDS) {
      $("#" + id).addEventListener("input", event => { item[id] = event.target.value; safeSave(); });
    }
    $("#checkStimulus").addEventListener("click", () => {
      const output = runStage(task.stimulus, $("#stimulusSql").value);
      item.stimulusSql = $("#stimulusSql").value;
      item.stimulusPassed = output.passed;
      item.checkSummary = output.results.map(result => ({label: result.label, pass: result.pass}));
      $("#checkResults").innerHTML = checkMarkup(output);
      showLog("#stimulusLog", output);
      const feedback = $("#stimulusFeedback");
      feedback.className = `feedback ${output.passed ? "ok" : "bad"}`;
      const passed = output.results.filter(result => result.pass).length;
      feedback.textContent = output.passed ? `PASS · ${passed}/${output.results.length} kasus uji terpenuhi.` : `BELUM PASS · ${passed}/${output.results.length} kasus uji terpenuhi. Seluruh kasus wajib lulus.`;
      if (!safeSave()) feedback.textContent += " Penyimpanan lokal gagal; salin SQL sebelum menutup halaman.";
      updateProgress();
    });
    $("#resetStimulus").addEventListener("click", () => {
      item.stimulusSql = task.stimulus.starterSql;
      item.stimulusPassed = false;
      item.checkSummary = [];
      safeSave();
      showTask(current);
    });
    $("#saveLive").addEventListener("click", () => {
      for (const id of LIVE_FIELDS) item[id] = $("#" + id).value.trim();
      const stored = safeSave();
      const feedback = $("#liveFeedback");
      feedback.className = `feedback ${stored && complete(task) ? "ok" : "bad"}`;
      feedback.textContent = !stored ? "Penyimpanan gagal; salin teks sebelum menutup halaman." : complete(task) ? "Tugas tercapai: stimulus PASS, prediksi, SQL live, verifikasi sebelum-sesudah, refleksi, dan bukti tersedia." : "Tersimpan. Kelengkapan memerlukan stimulus PASS, seluruh catatan live, dan minimal satu gambar.";
      updateProgress();
      renderReport();
    });
    $("#imageInput").addEventListener("change", event => {
      const input = event.currentTarget;
      const files = Array.from(input.files || []);
      input.value = "";
      uploadQueue = uploadQueue.then(() => addImages(task, files)).catch(error => {
        const feedback = $("#imageFeedback");
        if (feedback) { feedback.className = "feedback bad"; feedback.textContent = error.message || "Gambar gagal diproses."; }
      });
    });
    $("#evidenceList").addEventListener("click", event => {
      const button = event.target.closest("[data-remove-image-id]");
      if (!button) return;
      const previousImages = item.images.slice();
      item.images = item.images.filter(image => image.id !== button.dataset.removeImageId);
      if (!safeSave()) {
        item.images = previousImages;
        const feedback = $("#imageFeedback");
        feedback.className = "feedback bad";
        feedback.textContent = "Gagal menghapus karena penyimpanan lokal ditolak; rollback diterapkan.";
        return;
      }
      showTask(current);
      renderReport();
    });
    document.querySelectorAll("[data-theory-anchor]").forEach(link => link.addEventListener("click", () => openTab("teori")));
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Konversi gambar gagal."));
      reader.readAsDataURL(blob);
    });
  }
  function canvasBlob(canvas, quality) { return new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality)); }

  async function compressImage(file) {
    if (!file || !/^image\//i.test(file.type)) throw new Error(`${file?.name || "Berkas"}: bukan gambar.`);
    if (file.size > 12 * 1024 * 1024) throw new Error(`${file.name}: sumber melebihi 12 MB.`);
    const bitmap = await createImageBitmap(file);
    let width = bitmap.width;
    let height = bitmap.height;
    const initialScale = Math.min(1, 1280 / Math.max(width, height));
    width = Math.max(1, Math.round(width * initialScale));
    height = Math.max(1, Math.round(height * initialScale));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", {alpha: false});
    const redraw = () => {
      canvas.width = width;
      canvas.height = height;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
    };
    redraw();
    const limit = 220 * 1024;
    let blob = null;
    for (let sizePass = 0; sizePass < 5 && (!blob || blob.size > limit); sizePass++) {
      for (let quality = .84; quality >= .20; quality -= .08) {
        blob = await canvasBlob(canvas, quality);
        if (blob && blob.size <= limit) break;
      }
      if (blob && blob.size <= limit) break;
      width = Math.max(480, Math.round(width * .84));
      height = Math.max(320, Math.round(height * .84));
      redraw();
    }
    if (!blob || blob.size > limit) { bitmap.close(); throw new Error(`${file.name}: hasil tidak dapat dipadatkan di bawah 220 KB.`); }
    let storedBlob = blob;
    let finalWidth = width;
    let finalHeight = height;
    if (initialScale === 1 && file.size <= blob.size && file.size <= limit) {
      storedBlob = file;
      finalWidth = bitmap.width;
      finalHeight = bitmap.height;
    }
    bitmap.close();
    return { id: uid(), dataUrl: await blobToDataUrl(storedBlob), name: file.name, sourceBytes: file.size, storedBytes: storedBlob.size, width: finalWidth, height: finalHeight, at: new Date().toISOString() };
  }

  async function addImages(task, files) {
    const feedback = $("#imageFeedback");
    const item = itemFor(task);
    const remaining = Math.max(0, 5 - item.images.length);
    if (!files.length) return;
    if (!remaining) {
      feedback.className = "feedback bad";
      feedback.textContent = "Maksimum lima gambar telah tercapai.";
      return;
    }
    const chosen = files.slice(0, remaining);
    const refusedForCap = files.length - chosen.length;
    const accepted = [], rejected = [];
    for (const file of chosen) {
      try { accepted.push(await compressImage(file)); }
      catch (error) { rejected.push(error.message || `${file.name}: gagal diproses.`); }
    }
    const liveRemaining = Math.max(0, 5 - item.images.length);
    const commit = accepted.slice(0, liveRemaining);
    const previousImages = item.images.slice();
    item.images.push(...commit);
    if (commit.length && !safeSave()) {
      item.images = previousImages;
      feedback.className = "feedback bad";
      feedback.textContent = "Kuota localStorage tidak cukup; seluruh penambahan dibatalkan dan keadaan lama dipulihkan (rollback).";
      showTask(current);
      return;
    }
    const refusedDuringCommit = accepted.length - commit.length;
    const messages = [`${commit.length} gambar ditambahkan.`];
    if (refusedForCap + refusedDuringCommit) messages.push(`${refusedForCap + refusedDuringCommit} gambar ditolak karena batas lima.`);
    if (rejected.length) messages.push(rejected.join(" "));
    showTask(current);
    const currentFeedback = $("#imageFeedback");
    currentFeedback.className = `feedback ${commit.length ? "ok" : "bad"}`;
    currentFeedback.textContent = messages.join(" ");
    updateProgress();
    renderReport();
  }

  $("#prevTask").addEventListener("click", () => showTask(current - 1));
  $("#nextTask").addEventListener("click", () => showTask(current + 1));

  const identityIds = ["studentName","studentId","studentClass","lecturer","reportPlace","reportDate","lecturerNotes","aiUse","aiTool"];
  function fillIdentity() {
    for (const id of identityIds) {
      const field = $("#" + id);
      if (!field) continue;
      field.value = state.identity[id] || (id === "lecturer" ? LECTURER : id === "reportDate" ? today() : "");
    }
  }
  $("#saveIdentity").addEventListener("click", () => {
    for (const id of identityIds) state.identity[id] = $("#" + id).value.trim();
    const status = $("#reportStatus");
    status.textContent = safeSave() ? "Identitas dan deklarasi tersimpan." : "Identitas gagal disimpan; salin data sebelum menutup halaman.";
    renderReport();
  });
  $("#buildReport").addEventListener("click", renderReport);
  $("#printReport").addEventListener("click", () => { renderReport(); setTimeout(() => window.print(), 50); });
  $("#resetAll").addEventListener("click", () => {
    if (!window.confirm("Hapus seluruh jawaban, identitas, progres, dan screenshot? Tindakan ini tidak dapat dibatalkan.")) return;
    try { localStorage.removeItem(KEY); } catch (_) {}
    state = blank();
    current = 0;
    fillIdentity();
    showTask(0);
    renderReport();
    $("#reportStatus").textContent = "Seluruh data dan screenshot telah dihapus.";
  });

  // Cadangan JSON: seluruh state (termasuk screenshot) diunduh sebagai berkas lokal dan dapat dipulihkan di perangkat lain.
  function backupData() {
    const blob = new Blob([JSON.stringify({ key: KEY, exportedAt: new Date().toISOString(), state }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `P05_cadangan_${(state.identity.studentId || "mahasiswa").replace(/[^\w-]/g, "")}_${today()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    $("#reportStatus").textContent = "Cadangan JSON diunduh. Simpan berkas ini di tempat aman.";
  }

  function restoreData(file) {
    const status = $("#reportStatus");
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => { status.textContent = "Berkas cadangan tidak dapat dibaca."; };
    reader.onload = () => {
      let parsed;
      try { parsed = JSON.parse(String(reader.result)); }
      catch (_) { status.textContent = "Berkas bukan JSON yang sah; data lama tidak diubah."; return; }
      if (!parsed || parsed.key !== KEY || typeof parsed.state !== "object") { status.textContent = "Berkas bukan cadangan modul P05; data lama tidak diubah."; return; }
      const previous = state;
      state = migrate(parsed.state);
      if (!safeSave()) { state = previous; status.textContent = "Kuota penyimpanan tidak cukup; pemulihan dibatalkan (rollback)."; return; }
      current = state.current;
      fillIdentity();
      showTask(current);
      renderReport();
      status.textContent = `Cadangan dipulihkan: ${completedCount()}/${tasks.length} tugas tercapai.`;
    };
    reader.readAsText(file);
  }
  $("#backupData").addEventListener("click", backupData);
  $("#restoreData").addEventListener("change", event => { restoreData(event.currentTarget.files?.[0]); event.currentTarget.value = ""; });

  function identityValue(id) { return state.identity[id] || "Belum diisi"; }
  function letterhead() {
    return `<header class="letterhead"><img src="assets/logo-polinela.png" alt="Logo Politeknik Negeri Lampung"><div><h2>POLITEKNIK NEGERI LAMPUNG</h2><p>PROGRAM STUDI D-III MANAJEMEN INFORMATIKA</p><p>PMI 1320 · SISTEM BASIS DATA · PERTEMUAN 5 · SEMESTER 3</p></div><img src="assets/logo-sdgs.jpg" alt="Logo SDG 4 dan SDG 9"></header>`;
  }
  function reportPage(content, className = "") {
    return `<section class="report-page ${className}">${letterhead()}<div class="report-body">${content}</div><footer class="page-footer"></footer></section>`;
  }
  function checkSummary(item) {
    if (!Array.isArray(item.checkSummary) || !item.checkSummary.length) return '<span class="empty">Belum diisi</span>';
    return `<ul>${item.checkSummary.map(check => `<li>${check.pass ? "Lulus" : "Belum"} — ${esc(check.label)}</li>`).join("")}</ul>`;
  }
  const block = value => filled(value) ? `<pre>${esc(value)}</pre>` : '<p class="empty">Belum diisi</p>';

  function renderReport() {
    const mapping = tasks.map((task, index) => {
      const item = itemFor(task);
      const thumbnails = item.images.length ? item.images.map((image, imageIndex) => `<img class="recap-thumb" src="${image.dataUrl}" alt="Thumbnail bukti ${index + 1}.${imageIndex + 1}">`).join("") : '<span class="empty">Belum diisi</span>';
      return `<tr><td>${index + 1}</td><td>${esc(task.topic)}</td><td>${task.anchors.map(anchor => esc(anchor.replace("teori-", ""))).join(", ")}</td><td>CPMK-2 / Sub-3</td><td><span class="status-pill ${complete(task) ? "done" : ""}">${complete(task) ? "Tercapai" : "Belum diisi"}</span></td><td><div class="recap-thumbs">${thumbnails}</div></td></tr>`;
    }).join("");
    const aiText = state.identity.aiUse === "tidak" ? "Tidak menggunakan AI generatif" : state.identity.aiUse === "ya" ? `Menggunakan AI generatif: ${identityValue("aiTool")}` : "Belum diisi";
    const pages = [];
    pages.push(reportPage(`<h1>LEMBAR HASIL PRAKTIKUM</h1><p class="report-subtitle">P05 · Manipulasi Data (INSERT, UPDATE, DELETE)</p>
      <table class="report-table identity-table"><tbody><tr><th scope="row">Nama</th><td>${empty(state.identity.studentName)}</td><th scope="row">NIM</th><td>${empty(state.identity.studentId)}</td></tr><tr><th scope="row">Kelas</th><td>${empty(state.identity.studentClass)}</td><th scope="row">Semester</th><td>3</td></tr><tr><th scope="row">Tempat / tanggal</th><td>${empty(state.identity.reportPlace)} / ${empty(state.identity.reportDate)}</td><th scope="row">Dosen</th><td>${empty(state.identity.lecturer)}</td></tr><tr><th scope="row">Deklarasi AI</th><td colspan="3">${esc(aiText)}</td></tr></tbody></table>
      <h2>Capaian Pembelajaran</h2><p><strong>Pertemuan / Minggu:</strong> 5 · <strong>Sub-CPMK:</strong> Sub-3</p><h3>CPMK-2</h3><p>Mengimplementasikan skema basis data dan query SQL untuk kebutuhan sistem informasi.</p><h3>Sub-3</h3><p>Mengimplementasikan query SQL untuk manipulasi, pemilihan, penggabungan, agregasi, subquery, dan view.</p><p><strong>Indikator:</strong> Melakukan insert, update, delete secara aman; minimal 70% kasus uji lulus.</p><p><strong>Materi:</strong> INSERT, UPDATE, DELETE; DEFAULT; LAST_INSERT_ID(); ROW_COUNT(); dampak constraint; data uji.</p><p><strong>Metode &amp; aktivitas:</strong> Live SQL; praktikum manipulasi data; verifikasi sebelum-sesudah.</p><p><strong>Alokasi waktu:</strong> T: 1×50 menit; P: 1×170 menit; PT+KM: 1×60 menit</p><p><strong>Asesmen:</strong> Praktikum manipulasi data, 5% · <strong>Sumber:</strong> PU-1; PU-2</p>
      <h2>Pemetaan lima tugas</h2><table class="report-table mapping-table"><thead><tr><th scope="col">No.</th><th scope="col">Tugas</th><th scope="col">Teori</th><th scope="col">Capaian</th><th scope="col">Status</th><th scope="col">Bukti ≤50 mm</th></tr></thead><tbody>${mapping}</tbody></table>`));

    tasks.forEach((task, index) => {
      const item = itemFor(task);
      pages.push(reportPage(`<article class="task-report"><h1>Tugas ${index + 1} · ${esc(task.topic)}</h1><p><strong>Kasus live:</strong> ${esc(task.live.caseName)}</p><p><strong>Target:</strong> ${esc(task.live.goal)}</p><p><strong>Status:</strong> ${complete(task) ? "Tercapai" : "Belum diisi"}</p><h2>SQL stimulus</h2>${block(item.stimulusSql)}<h2>Hasil kasus uji</h2>${checkSummary(item)}<h2>Prediksi dampak</h2><p>${empty(item.prediction)}</p><h2>SQL live mahasiswa</h2>${block(item.liveSql)}<h2>Verifikasi sebelum-sesudah</h2>${block(item.observation)}<h2>Refleksi</h2><p>${empty(item.reflection)}</p><p><strong>Jumlah bukti:</strong> ${item.images.length || "Belum diisi"}</p></article>`, "task-detail-page"));
    });

    const evidence = [];
    tasks.forEach((task, taskIndex) => itemFor(task).images.forEach((image, imageIndex) => evidence.push({task, taskIndex, image, imageIndex})));
    evidence.forEach((entry, appendixIndex) => pages.push(reportPage(`<h1>Lampiran Bukti Praktikum</h1><figure class="appendix-figure"><img class="appendix-image" src="${entry.image.dataUrl}" alt="Bukti penuh tugas ${entry.taskIndex + 1} gambar ${entry.imageIndex + 1}"><figcaption>Lampiran ${appendixIndex + 1}. Tugas ${entry.taskIndex + 1} · ${esc(entry.task.topic)} · ${esc(entry.image.name)} · ${Math.ceil(entry.image.storedBytes / 1024)} KB</figcaption></figure>`, "appendix")));

    pages.push(reportPage(`<h1>Pengesahan</h1><p>Laporan memuat ${tasks.length} tugas dan ${evidence.length} gambar bukti. Nilai yang belum tersedia ditandai “Belum diisi”. Mahasiswa menyatakan bukti berasal dari pelaksanaan pada MySQL Community Server 8.4 LTS dan tidak memuat kredensial.</p><h2>Catatan verifikasi dosen</h2><p>${empty(state.identity.lecturerNotes)}</p><div class="signature-grid"><div><p id="signaturePlaceDate">${empty(state.identity.reportPlace)}, ${empty(state.identity.reportDate)}<br>Mahasiswa,</p><div class="signature-space"></div><p><u id="signatureStudentName">${empty(state.identity.studentName)}</u><br>NIM <span id="signatureStudentId">${empty(state.identity.studentId)}</span></p></div><div><p>Dosen Pengampu,</p><div class="signature-space"></div><p><u id="signatureLecturer">${empty(state.identity.lecturer || LECTURER)}</u></p></div></div>`, "signature-page"));

    $("#reportPages").innerHTML = pages.join("");
    const allPages = document.querySelectorAll("#reportPages .report-page");
    allPages.forEach((page, index) => { page.querySelector(".page-footer").textContent = `Halaman ${index + 1} dari ${allPages.length}`; });
    const missingIdentity = !state.identity.studentName || !state.identity.studentId || !state.identity.studentClass;
    const missingDeclaration = !state.identity.aiUse || (state.identity.aiUse === "ya" && !state.identity.aiTool);
    const status = $("#reportStatus");
    if (status) status.textContent = missingIdentity ? "Belum siap: lengkapi nama, NIM, dan kelas." : missingDeclaration ? "Belum siap: lengkapi deklarasi penggunaan AI." : completedCount() === 0 ? "Belum siap: tuntaskan minimal satu tugas." : `Rekap siap diperiksa: ${completedCount()}/${tasks.length} tugas tercapai.`;
  }

  window.__P05 = {
    key: KEY,
    rps: RPS,
    state: () => state,
    tasks: () => tasks,
    safeLoad,
    safeSave,
    migrate,
    renderReport,
    showTask,
    openTab,
    compressImage,
    addImages,
    backupData,
    restoreData,
    complete: id => complete(tasks.find(task => task.id === id)),
    replaceStateForQa: value => { state = migrate(value); current = state.current; fillIdentity(); showTask(current); renderReport(); return state; }
  };

  buildNav();
  showTask(current);
  fillIdentity();
  renderReport();
})();
