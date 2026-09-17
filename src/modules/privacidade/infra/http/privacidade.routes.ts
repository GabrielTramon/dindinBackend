import { Router } from 'express';
import { authOf, type AuthMiddlewares } from '../../../../shared/infra/http/authentication';
import { parseBody } from '../../../../shared/infra/http/validation';
import type { ExcluirContaUseCase } from '../../application/excluir-conta.use-case';
import type { ExportarDadosUseCase } from '../../application/exportar-dados.use-case';
import { nomeDoArquivoExportado, presentDadosExportados } from './dados-exportados.presenter';
import { excluirContaBody } from './privacidade.schemas';

/*
  GET    /me/exportar   baixa tudo que o dindin guarda sobre a pessoa (arquivo JSON)   200
  DELETE /me            exclui a conta e todos os dados; corpo { confirmacao }         204

  O controller só traduz: HTTP → entrada do caso de uso → presenter. Nenhuma
  regra de negócio mora aqui.
*/

export interface PrivacidadeRouterDeps {
  exportar: ExportarDadosUseCase;
  excluir: ExcluirContaUseCase;
  auth: AuthMiddlewares;
}

export function createPrivacidadeRouter(deps: PrivacidadeRouterDeps): Router {
  const router = Router();

  router.get('/me/exportar', deps.auth.requireAuth, async (req, res) => {
    const dados = await deps.exportar.execute({ subscriberId: authOf(req).subscriberId });
    // o arquivo inteiro é dado pessoal: nenhum cache (navegador, proxy, CDN) guarda cópia
    res.set('Cache-Control', 'no-store');
    res.set('Content-Disposition', `attachment; filename="${nomeDoArquivoExportado(dados.exportadoEm)}"`);
    // indentado: é um arquivo pra pessoa abrir e ler, não só pra máquina
    res.type('json').send(JSON.stringify(presentDadosExportados(dados), null, 2));
  });

  router.delete('/me', deps.auth.requireAuth, async (req, res) => {
    const { confirmacao } = parseBody(req, excluirContaBody);
    await deps.excluir.execute({ subscriberId: authOf(req).subscriberId, confirmacao });
    res.status(204).end();
  });

  return router;
}
