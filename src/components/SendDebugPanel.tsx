import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Trash2, ChevronDown, Info, XCircle, Server, Zap } from 'lucide-react';
import { logsListForRun } from '@/lib/noco-api';

interface DebugError {
  id: string;
  timestamp: string;
  number: string;
  blockType: string;
  errorSource: 'evolution' | 'server' | 'scheduler' | 'validation' | 'unknown';
  errorCode?: string;
  httpStatus?: number;
  errorMessage: string;
  fullDetails: any;
  suggestions: string[];
  profileId?: string;
  runId: string;
}

interface SendDebugPanelProps {
  selectedProfileId: string;
  currentRunId: string | null;
}

export function SendDebugPanel({ selectedProfileId, currentRunId }: SendDebugPanelProps) {
  const [errors, setErrors] = useState<DebugError[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Carrega erros do localStorage ao iniciar
  useEffect(() => {
    try {
      const stored = localStorage.getItem('send_debug_errors');
      if (stored) {
        const parsed = JSON.parse(stored);
        setErrors(parsed);
      }
    } catch (e) {
      console.error('[SendDebug] Erro ao carregar erros do cache:', e);
    }
  }, []);

  // Salva erros no localStorage sempre que mudar
  useEffect(() => {
    try {
      localStorage.setItem('send_debug_errors', JSON.stringify(errors));
    } catch (e) {
      console.error('[SendDebug] Erro ao salvar erros no cache:', e);
    }
  }, [errors]);

  // Busca logs de erro quando há um runId ativo
  useEffect(() => {
    if (!currentRunId || !selectedProfileId) return;

    const fetchErrors = async () => {
      setIsLoading(true);
      try {
        console.log('[SendDebug] 🔍 Buscando logs de erro para run_id:', currentRunId);
        const result = await logsListForRun(currentRunId);
        const logs = result?.list || [];
        
        console.log('[SendDebug] 📦 Logs recebidos:', logs.length);
        
        // Filtra apenas erros
        const errorLogs = logs.filter((log: any) => log.level === 'error');
        console.log('[SendDebug] ❌ Logs de erro encontrados:', errorLogs.length);

        // Processa cada erro
        const processedErrors: DebugError[] = errorLogs.map((log: any) => {
          return analyzeError(log, currentRunId, selectedProfileId);
        });

        // Adiciona novos erros sem duplicar
        setErrors(prev => {
          const existingIds = new Set(prev.map(e => e.id));
          const newErrors = processedErrors.filter(e => !existingIds.has(e.id));
          if (newErrors.length > 0) {
            console.log('[SendDebug] ➕ Adicionando', newErrors.length, 'novos erros');
          }
          return [...prev, ...newErrors];
        });
      } catch (error) {
        console.error('[SendDebug] ❌ Erro ao buscar logs:', error);
      } finally {
        setIsLoading(false);
      }
    };

    // Busca inicial
    fetchErrors();

    // Poll a cada 5 segundos enquanto há um runId ativo
    const interval = setInterval(fetchErrors, 5000);
    return () => clearInterval(interval);
  }, [currentRunId, selectedProfileId]);

  // Analisa um log de erro e extrai todas as informações possíveis
  const analyzeError = (log: any, runId: string, profileId: string): DebugError => {
    console.log('[SendDebug] 🔬 Analisando log:', log);

    let messageJson: any = null;
    try {
      messageJson = typeof log.message_json === 'string' 
        ? JSON.parse(log.message_json) 
        : log.message_json;
    } catch (e) {
      // Ignora erro de parse
    }

    // Extrai número do destinatário
    const number = extractNumber(log, messageJson);

    // Determina a origem do erro
    const errorSource = determineErrorSource(log, messageJson);

    // Extrai código e status HTTP
    const httpStatus = Number(log.http_status || log.http_code || messageJson?.status || 0);
    const errorCode = messageJson?.error?.code || messageJson?.code || log.error_code;

    // Extrai mensagem de erro completa
    const errorMessage = extractErrorMessage(log, messageJson);

    // Determina tipo de bloco
    const blockType = messageJson?.action || log.action || messageJson?.body?.mediatype || 'unknown';

    // Gera sugestões baseadas no erro
    const suggestions = generateSuggestions(errorSource, errorMessage, httpStatus, messageJson);

    return {
      id: String(log.Id || Date.now()),
      timestamp: log.CreatedAt || new Date().toISOString(),
      number,
      blockType,
      errorSource,
      errorCode,
      httpStatus,
      errorMessage,
      fullDetails: {
        log,
        messageJson,
        rawError: log.error || log.error_message,
        evolutionResponse: messageJson?.response || messageJson?.data,
      },
      suggestions,
      profileId,
      runId,
    };
  };

  const extractNumber = (log: any, messageJson: any): string => {
    const tryFields = [
      log?.number,
      log?.to,
      log?.recipient,
      log?.phone,
      messageJson?.body?.number,
      messageJson?.number,
    ];

    for (const field of tryFields) {
      if (field) {
        const cleaned = String(field).replace(/\D+/g, '');
        if (cleaned && cleaned.length >= 10) return cleaned;
      }
    }

    return 'Número não identificado';
  };

  const determineErrorSource = (log: any, messageJson: any): DebugError['errorSource'] => {
    const httpStatus = Number(log.http_status || log.http_code || messageJson?.status || 0);
    const errorMsg = String(
      messageJson?.error || 
      messageJson?.message || 
      log.error_message || 
      log.error || 
      ''
    ).toLowerCase();

    // Erros de Evolution API
    if (httpStatus === 401 || httpStatus === 403) return 'evolution';
    if (errorMsg.includes('instance') || errorMsg.includes('instância')) return 'evolution';
    if (errorMsg.includes('not connected') || errorMsg.includes('disconnected')) return 'evolution';
    if (errorMsg.includes('banned') || errorMsg.includes('bloqueado')) return 'evolution';
    if (errorMsg.includes('unauthorized') || errorMsg.includes('forbidden')) return 'evolution';

    // Erros de validação
    if (httpStatus >= 400 && httpStatus < 500) return 'validation';
    if (errorMsg.includes('invalid') || errorMsg.includes('inválido')) return 'validation';
    if (errorMsg.includes('required') || errorMsg.includes('obrigatório')) return 'validation';

    // Erros de servidor/agendador
    if (httpStatus >= 500) return 'server';
    if (errorMsg.includes('timeout') || errorMsg.includes('tempo esgotado')) return 'scheduler';
    if (errorMsg.includes('network') || errorMsg.includes('conexão')) return 'server';

    return 'unknown';
  };

  const extractErrorMessage = (log: any, messageJson: any): string => {
    // Tenta múltiplas fontes de erro
    const sources = [
      messageJson?.error?.message,
      messageJson?.error,
      messageJson?.message,
      messageJson?.response?.error,
      messageJson?.response?.message,
      messageJson?.data?.error,
      messageJson?.data?.message,
      log.error_message,
      log.error,
      log.reason,
      log.message,
    ];

    for (const source of sources) {
      if (source && typeof source === 'string' && source.trim()) {
        return source.trim();
      }
      if (source && typeof source === 'object') {
        return JSON.stringify(source, null, 2);
      }
    }

    // Se tiver HTTP status >= 400, usa ele
    const httpStatus = Number(log.http_status || log.http_code || 0);
    if (httpStatus >= 400) {
      return `HTTP ${httpStatus}: ${getHttpStatusMessage(httpStatus)}`;
    }

    return 'Erro desconhecido - verifique os detalhes completos abaixo';
  };

  const getHttpStatusMessage = (status: number): string => {
    const messages: Record<number, string> = {
      400: 'Requisição inválida',
      401: 'Não autorizado - verifique o token da Evolution API',
      403: 'Acesso proibido',
      404: 'Recurso não encontrado - instância pode não existir',
      410: 'Instância não está mais disponível',
      423: 'Instância está bloqueada',
      429: 'Muitas requisições - aguarde antes de enviar novamente',
      500: 'Erro interno do servidor Evolution',
      502: 'Gateway inválido - servidor Evolution pode estar offline',
      503: 'Serviço indisponível temporariamente',
      504: 'Timeout na conexão com Evolution API',
    };

    return messages[status] || 'Erro desconhecido';
  };

  const generateSuggestions = (
    source: DebugError['errorSource'],
    message: string,
    httpStatus: number,
    messageJson: any
  ): string[] => {
    const suggestions: string[] = [];
    const msgLower = message.toLowerCase();

    // Sugestões por origem
    switch (source) {
      case 'evolution':
        suggestions.push('🔧 Verifique se a instância Evolution está conectada');
        suggestions.push('🔑 Confirme se o token da API está correto');
        if (httpStatus === 404 || httpStatus === 410) {
          suggestions.push('⚠️ A instância pode ter sido deletada ou não existe');
          suggestions.push('📱 Reconecte o WhatsApp na Evolution API');
        }
        if (msgLower.includes('banned') || msgLower.includes('bloqueado')) {
          suggestions.push('🚫 Número pode estar banido pelo WhatsApp');
          suggestions.push('⏰ Aguarde 24-48h antes de tentar enviar novamente');
        }
        break;

      case 'validation':
        suggestions.push('✅ Verifique se todos os campos obrigatórios estão preenchidos');
        suggestions.push('📋 Confirme o formato dos dados enviados');
        if (msgLower.includes('number') || msgLower.includes('número')) {
          suggestions.push('📞 Verifique o formato do número de telefone (deve estar em E.164)');
        }
        if (msgLower.includes('url') || msgLower.includes('media')) {
          suggestions.push('🔗 Confirme se a URL do arquivo está acessível e pública');
        }
        break;

      case 'server':
        suggestions.push('🔄 Tente novamente em alguns minutos');
        suggestions.push('📡 Verifique a conexão com o servidor Evolution');
        if (httpStatus >= 500) {
          suggestions.push('⚙️ Servidor Evolution pode estar com problemas temporários');
        }
        break;

      case 'scheduler':
        suggestions.push('⏱️ Erro de timeout - servidor demorou para responder');
        suggestions.push('📊 Reduza a quantidade de envios simultâneos');
        suggestions.push('🔄 Aguarde alguns segundos e tente novamente');
        break;

      default:
        suggestions.push('📋 Verifique os detalhes completos do erro abaixo');
        suggestions.push('💬 Entre em contato com o suporte com estas informações');
    }

    // Sugestões específicas por mensagem
    if (msgLower.includes('not found') || msgLower.includes('não encontrado')) {
      suggestions.push('🔍 Recurso não encontrado - verifique se a instância existe');
    }
    if (msgLower.includes('timeout')) {
      suggestions.push('⏰ Aumente o intervalo entre envios');
    }
    if (msgLower.includes('rate limit') || msgLower.includes('too many')) {
      suggestions.push('🐌 WhatsApp está limitando seus envios - diminua a velocidade');
    }

    return suggestions;
  };

  const clearDebugCache = () => {
    setErrors([]);
    localStorage.removeItem('send_debug_errors');
    console.log('[SendDebug] 🧹 Cache de debug limpo');
  };

  // Filtra erros do perfil selecionado
  const filteredErrors = errors.filter(e => e.profileId === selectedProfileId);

  const getSourceIcon = (source: DebugError['errorSource']) => {
    switch (source) {
      case 'evolution': return <Zap className="w-4 h-4" />;
      case 'server': return <Server className="w-4 h-4" />;
      case 'scheduler': return <AlertCircle className="w-4 h-4" />;
      case 'validation': return <XCircle className="w-4 h-4" />;
      default: return <Info className="w-4 h-4" />;
    }
  };

  const getSourceLabel = (source: DebugError['errorSource']): string => {
    switch (source) {
      case 'evolution': return 'Evolution API';
      case 'server': return 'Servidor';
      case 'scheduler': return 'Agendador';
      case 'validation': return 'Validação';
      default: return 'Desconhecido';
    }
  };

  const getSourceColor = (source: DebugError['errorSource']): string => {
    switch (source) {
      case 'evolution': return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
      case 'server': return 'bg-red-500/10 text-red-500 border-red-500/20';
      case 'scheduler': return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
      case 'validation': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
      default: return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
    }
  };

  if (filteredErrors.length === 0 && !isLoading) {
    return null;
  }

  return (
    <Card className="p-4 bg-background border-destructive/20">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-destructive" />
          <h3 className="text-lg font-semibold text-foreground">
            Debug de Envios ({filteredErrors.length})
          </h3>
          {isLoading && (
            <Badge variant="outline" className="animate-pulse">
              Atualizando...
            </Badge>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={clearDebugCache}
          disabled={filteredErrors.length === 0}
          className="gap-2"
        >
          <Trash2 className="w-4 h-4" />
          Limpar Debug
        </Button>
      </div>

      <ScrollArea className="h-[400px] pr-4">
        <Accordion type="single" collapsible className="space-y-2">
          {filteredErrors.map((error) => (
            <AccordionItem
              key={error.id}
              value={error.id}
              className="border rounded-lg bg-card"
            >
              <AccordionTrigger className="px-4 py-3 hover:no-underline">
                <div className="flex items-start gap-3 w-full text-left">
                  <div className="flex-shrink-0 mt-0.5">
                    {getSourceIcon(error.errorSource)}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant="outline"
                        className={`text-xs ${getSourceColor(error.errorSource)}`}
                      >
                        {getSourceLabel(error.errorSource)}
                      </Badge>
                      {error.httpStatus && error.httpStatus >= 400 && (
                        <Badge variant="destructive" className="text-xs">
                          HTTP {error.httpStatus}
                        </Badge>
                      )}
                      {error.errorCode && (
                        <Badge variant="outline" className="text-xs">
                          {error.errorCode}
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-xs">
                        {error.blockType}
                      </Badge>
                    </div>
                    <p className="text-sm font-medium line-clamp-1">
                      📞 {error.number}
                    </p>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {error.errorMessage}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(error.timestamp).toLocaleString('pt-BR')}
                    </p>
                  </div>
                  <ChevronDown className="w-4 h-4 shrink-0 transition-transform duration-200" />
                </div>
              </AccordionTrigger>

              <AccordionContent className="px-4 pb-4">
                <div className="space-y-4 pt-2">
                  {/* Mensagem de erro completa */}
                  <div>
                    <h4 className="text-sm font-semibold mb-2 text-foreground">
                      💬 Mensagem de Erro:
                    </h4>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted/50 p-3 rounded-md">
                      {error.errorMessage}
                    </p>
                  </div>

                  {/* Sugestões de resolução */}
                  {error.suggestions.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold mb-2 text-foreground">
                        💡 Sugestões de Resolução:
                      </h4>
                      <ul className="space-y-1">
                        {error.suggestions.map((suggestion, idx) => (
                          <li
                            key={idx}
                            className="text-sm text-muted-foreground pl-4"
                          >
                            {suggestion}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Detalhes técnicos completos */}
                  <div>
                    <h4 className="text-sm font-semibold mb-2 text-foreground">
                      🔧 Detalhes Técnicos Completos:
                    </h4>
                    <pre className="text-xs bg-muted/50 p-3 rounded-md overflow-x-auto">
                      {JSON.stringify(error.fullDetails, null, 2)}
                    </pre>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </ScrollArea>
    </Card>
  );
}
