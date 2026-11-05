/**
 * SonghaiCRM — testes do upstream que provam o que ESTA distribuição desliga.
 *
 * Mora na RAIZ (ao lado de `vitest.cercas.ts`) e não em `tests/`: os `vitest*.ts`
 * entram na imagem Docker e o `.dockerignore` exclui `tests/` (cerca `pr-mexe-na-imagem`).
 *
 * O produto é só de Moçambique (pt-MZ, MZN, NUIT, Lei n.º 3/2017). O upstream
 * também prova espanhol, turco, pt-BR, CPF, LGPD por país e a cobrança do Brasil.
 * Esses ficheiros continuam no repositório (o merge com o `upstream/main` não
 * quer um delete), mas o Vitest não os corre aqui — e cada um entra com o MOTIVO
 * escrito. A cerca `tests/unit/fora-da-oferta-so-o-que-esta-escrito.test.ts`
 * reprova ficheiro que já não existe e motivo vazio.
 *
 * Regra: um teste só entra aqui se o COMPORTAMENTO que ele prova está desligado
 * por decisão do dono (docs/songhai-diferencas-do-upstream.md §7). Teste cuja
 * expectativa é só o TEXTO brasileiro (Salvar, contato, …) NÃO entra: corrige-se
 * a expectativa para pt-MZ.
 */
export type ForaDaOferta = { arquivo: string; motivo: string };

const ESPANHOL = "Prova a interface em espanhol/turco/pt-BR; esta distribuição serve só pt-MZ (lib/i18n/registro.ts).";
const CPF = "Prova o CPF/CNPJ brasileiro; o documento desta distribuição é o NUIT (lib/legal/perfil-do-pais.ts).";
const LGPD_POR_PAIS = "Prova o texto/PDF da LGPD por país; esta distribuição tem só o perfil MZ (Lei n.º 3/2017).";
const PAIS_FORA = "Prova perfis, moedas ou rótulos de países que a distribuição não oferece (só MZ; PT escondido em FORA_DA_OFERTA_NESTA_DISTRIBUICAO).";
const MOEDA_EN = "Prova o dólar na convenção en-US (\"$1,300.00\", vírgula de milhar); a distribuição escreve o dólar como em Moçambique (\"1 300,00 US$\" — LOCALE_DA_MOEDA_SEM_PAIS em lib/money.ts) e o parser segue o mesmo Intl.";
const BYTE_A_BYTE_BR = "Compara o e-mail byte a byte com a saída em pt-BR da main do upstream; aqui o e-mail passa pela camada pt-MZ (lib/i18n/pt-mz.ts) e a saída é, de propósito, diferente.";
const COBRANCA_BR_PLANO = "Monta um plano em `cobranca_planos`, cuja moeda é só BRL por desenho (check do baseline do upstream); o módulo `cobranca` está fora da oferta (MODULOS_DO_BRASIL) e esta distribuição cobra em MZN pela faturação própria.";
const COBRANCA_BR = "Prova a cobrança Stripe/Asaas do Brasil; o módulo `cobranca` está fora da oferta (MODULOS_DO_BRASIL).";

export const FORA_DA_OFERTA: readonly ForaDaOferta[] = [
  { arquivo: "curso/idioma.test.ts", motivo: ESPANHOL },
  { arquivo: "tests/unit/admin-perfil-e-idioma-sem-texto-cru.test.ts", motivo: ESPANHOL },
  { arquivo: "tests/unit/fachada-segue-o-idioma-do-visitante.test.tsx", motivo: ESPANHOL },
  { arquivo: "tests/unit/i18n-turco-em-construcao.test.ts", motivo: ESPANHOL },
  { arquivo: "tests/unit/negocio-e-o-nome-do-card.test.tsx", motivo: ESPANHOL },
  { arquivo: "tests/unit/recuperacao-de-senha-no-idioma.test.tsx", motivo: ESPANHOL },
  { arquivo: "tests/unit/textos-fora-da-traducao-nas-sequencias.test.tsx", motivo: ESPANHOL },
  { arquivo: "lib/agent-engine/agent/destino-da-intencao.test.ts", motivo: ESPANHOL },
  { arquivo: "tests/unit/lgpd-email-url-nao-vira-html.test.ts", motivo: ESPANHOL },
  { arquivo: "components/contacts/NewContactDialog.cpf.test.tsx", motivo: CPF },
  { arquivo: "components/contacts/NewContactDialog.documento-invalido.test.tsx", motivo: CPF },
  { arquivo: "tests/unit/cpf-no-campo.test.ts", motivo: CPF },
  { arquivo: "tests/unit/contato-cpf-e-email-duplicado-409.test.ts", motivo: CPF },
  { arquivo: "tests/unit/mascara-da-ingestao-tem-o-brasil-por-baixo.test.ts", motivo: CPF },
  { arquivo: "tests/unit/lgpd-alarme-por-idioma-e-mes-legal.test.tsx", motivo: LGPD_POR_PAIS },
  { arquivo: "tests/unit/lgpd-pdf-controlador.test.tsx", motivo: LGPD_POR_PAIS },
  { arquivo: "tests/unit/lgpd-pdf-meet.test.ts", motivo: LGPD_POR_PAIS },
  { arquivo: "tests/unit/lgpd-pdf-transcricao.test.ts", motivo: LGPD_POR_PAIS },
  { arquivo: "tests/unit/lgpd-rotulos-por-pais.test.tsx", motivo: LGPD_POR_PAIS },
  { arquivo: "tests/unit/lgpd-sla.test.ts", motivo: LGPD_POR_PAIS },
  { arquivo: "tests/unit/lgpd-texto-segue-o-pais.test.tsx", motivo: LGPD_POR_PAIS },
  { arquivo: "lib/cobranca/avisos.test.ts", motivo: COBRANCA_BR },
  { arquivo: "lib/cobranca/limites.test.ts", motivo: COBRANCA_BR },
  { arquivo: "tests/unit/admin-cobranca-abas.test.tsx", motivo: COBRANCA_BR },
  { arquivo: "tests/unit/card-de-cobranca-do-tenant.test.tsx", motivo: COBRANCA_BR },
  { arquivo: "tests/unit/criacao-de-tenant-com-plano-de-cobranca.test.ts", motivo: COBRANCA_BR },
  { arquivo: "tests/unit/novo-tenant-com-plano-de-cobranca.test.tsx", motivo: COBRANCA_BR },
  { arquivo: "tests/unit/tenant-overview-com-a-cobranca.test.tsx", motivo: COBRANCA_BR },
  { arquivo: "components/ai/UsageFilters.test.tsx", motivo: ESPANHOL },
  { arquivo: "lib/notifications/tela-bloqueada.test.ts", motivo: ESPANHOL },
  { arquivo: "tests/unit/i18n-idioma-do-navegador.test.ts", motivo: ESPANHOL },
  { arquivo: "tests/unit/idioma-aparece-pelo-nivel-do-registro.test.tsx", motivo: ESPANHOL },
  { arquivo: "tests/unit/branding-app-manifest.test.ts", motivo: ESPANHOL },
  { arquivo: "tests/unit/i18n-espanhol-cobre-a-tela.test.ts", motivo: ESPANHOL },
  { arquivo: "tests/unit/erro-global-oferece-todo-idioma.test.ts", motivo: ESPANHOL },
  { arquivo: "curso/espanhol-alvos.test.ts", motivo: ESPANHOL },
  { arquivo: "tests/unit/prospeccao-estrategia-em-espanhol.test.tsx", motivo: ESPANHOL },
  { arquivo: "tests/unit/telas-de-acesso-sem-texto-cru.test.tsx", motivo: ESPANHOL },
  { arquivo: "tests/unit/editor-e-automacoes-fora-da-traducao.test.tsx", motivo: ESPANHOL },
  { arquivo: "tests/unit/fusos-uma-lista-so.test.ts", motivo: ESPANHOL },
  { arquivo: "tests/unit/fuso-sugerido-pelo-pais.test.tsx", motivo: PAIS_FORA },
  { arquivo: "tests/unit/scrub-conhece-o-perfil-do-pais.test.ts", motivo: PAIS_FORA },
  { arquivo: "tests/unit/aviso-de-revisao-por-ia-no-seletor-de-pais.test.tsx", motivo: PAIS_FORA },
  { arquivo: "tests/unit/rotulos-da-organizacao-seguem-o-pais.test.tsx", motivo: PAIS_FORA },
  { arquivo: "tests/unit/previsao-respeita-a-moeda.test.tsx", motivo: PAIS_FORA },
  { arquivo: "components/kanban/valor-do-negocio-na-moeda-da-organizacao.test.tsx", motivo: MOEDA_EN },
  { arquivo: "tests/unit/honorarios-parcela-na-moeda-da-org.test.tsx", motivo: MOEDA_EN },
  { arquivo: "tests/unit/moeda-papel-e-telefone-do-pais.test.tsx", motivo: MOEDA_EN },
  { arquivo: "tests/unit/painel-de-metas.test.tsx", motivo: MOEDA_EN },
  { arquivo: "tests/unit/valor-digitado-na-moeda-da-org-cinco-chamadores.test.tsx", motivo: MOEDA_EN },
  { arquivo: "components/contacts/campo-de-moeda-com-enter.test.tsx", motivo: MOEDA_EN },
  { arquivo: "tests/unit/acoes-da-assinatura.test.tsx", motivo: COBRANCA_BR },
  { arquivo: "tests/unit/faixa-da-cobranca-link-https.test.tsx", motivo: COBRANCA_BR },
  { arquivo: "tests/unit/painel-da-assinatura.test.tsx", motivo: COBRANCA_BR },
  { arquivo: "components/admin/tenants/TenantActions.test.tsx", motivo: COBRANCA_BR },
  { arquivo: "tests/unit/agenda-aviso-teste-no-grupo-e-campos.test.tsx", motivo: PAIS_FORA },
  { arquivo: "tests/unit/destino-dinamico-no-editor.test.tsx", motivo: ESPANHOL },
  { arquivo: "app/app/settings/conversoes/_leadSubmittedCausal.test.tsx", motivo: ESPANHOL },
  { arquivo: "tests/unit/convite-email-html-preservado.test.ts", motivo: BYTE_A_BYTE_BR },
  { arquivo: "tests/unit/cobranca-duble-fala-a-lingua-do-asaas.test.ts", motivo: COBRANCA_BR },
  { arquivo: "lib/cobranca/provedores/asaas.test.ts", motivo: COBRANCA_BR },
  { arquivo: "tests/invariants/cobranca-assentos.test.ts", motivo: COBRANCA_BR_PLANO },
  { arquivo: "tests/invariants/cobranca-aviso-do-plano-e-do-orcamento.test.ts", motivo: COBRANCA_BR_PLANO },
  { arquivo: "tests/invariants/cobranca-avisos.test.ts", motivo: COBRANCA_BR_PLANO },
  { arquivo: "tests/invariants/cobranca-canais-isencao-so-waha.test.ts", motivo: COBRANCA_BR_PLANO },
  { arquivo: "tests/invariants/cobranca-canais-reviver-respeita-vaga.test.ts", motivo: COBRANCA_BR_PLANO },
  { arquivo: "tests/invariants/cobranca-canais-sem-numero-nao-ocupa.test.ts", motivo: COBRANCA_BR_PLANO },
  { arquivo: "tests/invariants/cobranca-canais.test.ts", motivo: COBRANCA_BR_PLANO },
  { arquivo: "tests/invariants/cobranca-entrada-paga-na-criacao.test.ts", motivo: COBRANCA_BR_PLANO },
  { arquivo: "tests/invariants/cobranca-exclusao-com-assinatura-viva.test.ts", motivo: COBRANCA_BR_PLANO },
  { arquivo: "tests/invariants/cobranca-isolamento.test.ts", motivo: COBRANCA_BR_PLANO },
  { arquivo: "tests/invariants/cobranca-limite-do-plano.test.ts", motivo: COBRANCA_BR_PLANO },
  { arquivo: "tests/invariants/cobranca-plano-oferecido.test.ts", motivo: COBRANCA_BR_PLANO },
  { arquivo: "tests/invariants/cobranca-reconciliacao.test.ts", motivo: COBRANCA_BR_PLANO },
  { arquivo: "tests/invariants/cobranca-suspensao-e-liberacao.test.ts", motivo: COBRANCA_BR_PLANO },
  { arquivo: "tests/invariants/cobranca-tabelas.test.ts", motivo: COBRANCA_BR_PLANO },
  { arquivo: "tests/invariants/cobranca-trial-na-criacao.test.ts", motivo: COBRANCA_BR_PLANO },
  { arquivo: "tests/invariants/cobranca-webhook-e-avisos.test.ts", motivo: COBRANCA_BR_PLANO },
  { arquivo: "tests/invariants/exclusao-recusa-cobranca.test.ts", motivo: COBRANCA_BR_PLANO },
  { arquivo: "tests/invariants/teto-do-plano.test.ts", motivo: COBRANCA_BR_PLANO },
];

export const ARQUIVOS_FORA_DA_OFERTA: string[] = FORA_DA_OFERTA.map((f) => f.arquivo);

