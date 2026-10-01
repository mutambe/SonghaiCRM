# Logotipo — SonghaiCRM

Coloca aqui o ficheiro do logotipo (PNG ou JPG, até 512 KB).

- `songhai_logo_800.png` — **o que se sobe pela tela** (800×748, ~51 KB, fundo transparente).
- `songhai_logo_transparent.png` — o original (2767×2588, 1,1 MB): passa do limite de 512 KB, fica como fonte.

O upload real acontece pela tela **`/admin/marca`** (ou `/app/settings/marca`
para uma organização específica) — é lá que o ficheiro é validado pelos bytes
e enviado ao storage da instalação. Esta pasta é só para guardares o ficheiro
fonte antes de subir.

Alternativa sem tela: apontar `APP_LOGO_URL` no `.env.local` para uma URL
pública da imagem (não para um ficheiro local desta pasta).
