// Upload de mapas, tokens, retratos, áudio e handouts.
// Segurança: limite de tamanho, lista branca de extensões/MIME, nomes aleatórios,
// nada é executado — os arquivos são servidos apenas como estáticos.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const KINDS = {
  map: { dir: 'maps', types: 'image', gmOnly: true },
  token: { dir: 'tokens', types: 'image', gmOnly: false },
  portrait: { dir: 'portraits', types: 'image', gmOnly: false },
  handout: { dir: 'handouts', types: 'image', gmOnly: true },
  audio: { dir: 'audio', types: 'audio', gmOnly: true }
};

const ALLOWED = {
  image: { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' },
  audio: { '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.webm': 'audio/webm' }
};

// Verifica a "assinatura" (magic bytes) para garantir que o arquivo é mesmo o que diz ser.
function sniff(buf) {
  const hex = buf.subarray(0, 12).toString('hex');
  const ascii = buf.subarray(0, 12).toString('latin1');
  if (hex.startsWith('89504e47')) return 'image';
  if (hex.startsWith('ffd8ff')) return 'image';
  if (ascii.startsWith('GIF8')) return 'image';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE') return 'audio';
  if (ascii.startsWith('ID3') || hex.startsWith('fffb') || hex.startsWith('fff3') || hex.startsWith('fff2')) return 'audio';
  if (ascii.startsWith('OggS')) return 'audio';
  if (ascii.slice(4, 8) === 'ftyp') return 'audio'; // m4a
  if (hex.startsWith('1a45dfa3')) return 'audio'; // webm
  return null;
}

function registerUploadRoutes(app, { store, config, auth, onUploaded }) {
  const baseDir = path.join(config.dataDir, 'uploads');
  for (const k of Object.values(KINDS)) fs.mkdirSync(path.join(baseDir, k.dir), { recursive: true });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.uploadMaxMB * 1024 * 1024, files: 1 }
  });

  app.post('/api/upload/:kind', auth.requireUser, (req, res) => {
    const kind = KINDS[req.params.kind];
    if (!kind) return res.status(400).json({ error: 'Tipo de upload inválido.' });
    if (kind.gmOnly && req.user.role !== 'gm') return res.status(403).json({ error: 'Apenas o Mestre pode enviar este tipo de arquivo.' });
    if (req.user.role === 'spectator') return res.status(403).json({ error: 'Espectadores não enviam arquivos.' });

    upload.single('file')(req, res, (err) => {
      if (err) {
        const msg = err.code === 'LIMIT_FILE_SIZE' ? `Arquivo maior que ${config.uploadMaxMB} MB.` : 'Falha no upload.';
        return res.status(400).json({ error: msg });
      }
      const file = req.file;
      if (!file) return res.status(400).json({ error: 'Nenhum arquivo recebido.' });
      const ext = path.extname(file.originalname).toLowerCase();
      const allowed = ALLOWED[kind.types];
      if (!allowed[ext]) return res.status(400).json({ error: `Extensão não permitida (${Object.keys(allowed).join(', ')}).` });
      if (sniff(file.buffer) !== kind.types) return res.status(400).json({ error: 'O conteúdo do arquivo não corresponde ao tipo.' });

      const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
      fs.writeFileSync(path.join(baseDir, kind.dir, filename), file.buffer);
      const url = `/uploads/${kind.dir}/${filename}`;
      store.uploads.add({ kind: req.params.kind, filename: url, original: file.originalname.slice(0, 200), mime: allowed[ext], size: file.size, user_id: req.user.id });
      if (onUploaded) onUploaded(req.params.kind);
      res.json({ url, name: file.originalname });
    });
  });

  app.get('/api/uploads/:kind', auth.requireGM, (req, res) => {
    res.json(store.uploads.list(req.params.kind));
  });

  // Arquivos enviados: servidos como estáticos, sem listagem de diretório.
  const express = require('express');
  app.use('/uploads', express.static(baseDir, {
    index: false,
    dotfiles: 'deny',
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'");
    }
  }));
}

module.exports = { registerUploadRoutes };
