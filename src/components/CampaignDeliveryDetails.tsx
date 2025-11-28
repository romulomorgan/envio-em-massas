import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  X, 
  ChevronDown, 
  RefreshCw, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  Phone,
  User,
  Clock,
  Server,
  Zap,
  FileWarning,
  HelpCircle,
  Download,
  Filter,
  Wifi,
  WifiOff,
  Loader2
} from 'lucide-react';
import { logsListForRun, logsListByQueueId } from '@/lib/noco-api';
import { formatPhoneLocal, formatBRDateTime, extractNumberFromLog, extractReasonFromLog } from '@/lib/utils-envio';
import { resendToContact, getCampaignProfileStatus, ProfileStatusResult } from '@/lib/api-resend';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';

// Tipos para os detalhes de entrega
export interface DeliveryDetail {
  id: string;
  number: string;
  name: string;
  status: 'success' | 'error' | 'pending';
  timestamp: string;
  errorSource?: 'evolution' | 'server' | 'validation' | 'network' | 'whatsapp' | 'unknown';
  errorMessage?: string;
  errorCode?: string;
  httpStatus?: number;
  suggestions: string[];
  rawLog: any;
  blockType?: string;
}

interface CampaignDeliveryDetailsProps {
  queueId: string | number;
  queueName: string;
  runId?: string;
  contactsCount: number;
  onClose: () => void;
}

// Função para determinar a origem do erro
function determineErrorSource(log: any, errorMsg: string): DeliveryDetail['errorSource'] {
  const msg = errorMsg.toLowerCase();
  const httpStatus = Number(log?.http_status || 0);
  
  // Erros de Evolution API
  if (httpStatus === 401 || httpStatus === 403) return 'evolution';
  if (msg.includes('instance') || msg.includes('instância') || msg.includes('instancia')) return 'evolution';
  if (msg.includes('not connected') || msg.includes('disconnected') || msg.includes('desconectado')) return 'evolution';
  if (msg.includes('qr code') || msg.includes('qrcode')) return 'evolution';
  
  // Erros do WhatsApp
  if (msg.includes('banned') || msg.includes('bloqueado') || msg.includes('banido')) return 'whatsapp';
  if (msg.includes('não é whatsapp') || msg.includes('not on whatsapp') || msg.includes('not a valid whatsapp')) return 'whatsapp';
  if (msg.includes('recipient') || msg.includes('destinatário')) return 'whatsapp';
  
  // Erros de validação
  if (msg.includes('invalid') || msg.includes('inválido') || msg.includes('invalido')) return 'validation';
  if (msg.includes('required') || msg.includes('obrigatório') || msg.includes('obrigatorio')) return 'validation';
  if (msg.includes('formato') || msg.includes('format')) return 'validation';
  if (msg.includes('número') || msg.includes('numero') || msg.includes('number')) return 'validation';
  if (msg.includes('ddd')) return 'validation';
  
  // Erros de rede/servidor
  if (httpStatus >= 500) return 'server';
  if (msg.includes('timeout') || msg.includes('tempo esgotado')) return 'network';
  if (msg.includes('connection') || msg.includes('conexão') || msg.includes('conexao')) return 'network';
  if (msg.includes('network') || msg.includes('rede')) return 'network';
  
  return 'unknown';
}

// Função para gerar sugestões baseadas no erro
function generateSuggestions(source: DeliveryDetail['errorSource'], errorMsg: string, httpStatus?: number): string[] {
  const suggestions: string[] = [];
  const msg = errorMsg.toLowerCase();
  
  switch (source) {
    case 'evolution':
      suggestions.push('🔌 Verifique se a instância Evolution API está conectada');
      suggestions.push('🔑 Confirme se o token/apikey da Evolution está correto');
      if (httpStatus === 404) {
        suggestions.push('⚠️ A instância pode não existir ou foi deletada');
      }
      if (msg.includes('qr') || msg.includes('desconect')) {
        suggestions.push('📱 Escaneie o QR Code novamente na Evolution API');
      }
      break;
      
    case 'whatsapp':
      if (msg.includes('banned') || msg.includes('bloqueado')) {
        suggestions.push('🚫 O número de destino pode estar bloqueado');
        suggestions.push('⏰ Aguarde 24-48h antes de tentar novamente');
        suggestions.push('📞 Verifique se o número está correto');
      }
      if (msg.includes('not on whatsapp') || msg.includes('não é whatsapp')) {
        suggestions.push('❌ Este número não possui WhatsApp');
        suggestions.push('📱 Verifique se o número está cadastrado no WhatsApp');
        suggestions.push('🔢 Confirme se o número está com DDD correto');
      }
      break;
      
    case 'validation':
      suggestions.push('📋 Verifique o formato do número de telefone');
      if (msg.includes('ddd')) {
        suggestions.push('🗺️ O DDD do número pode ser inválido');
      }
      if (msg.includes('9') || msg.includes('dígito')) {
        suggestions.push('9️⃣ Celulares brasileiros devem ter 9 no início (após DDD)');
      }
      suggestions.push('✅ Formato esperado: +55 + DDD + 9 + 8 dígitos');
      break;
      
    case 'network':
      suggestions.push('🔄 Erro de conexão - tente reenviar em alguns minutos');
      suggestions.push('📡 Verifique se o servidor Evolution está online');
      suggestions.push('⏱️ Pode ser um problema temporário de rede');
      break;
      
    case 'server':
      suggestions.push('🖥️ Erro interno do servidor');
      suggestions.push('🔄 Tente novamente em alguns minutos');
      suggestions.push('📞 Se persistir, entre em contato com o suporte');
      break;
      
    default:
      suggestions.push('📋 Verifique os detalhes completos do erro');
      suggestions.push('🔄 Tente reenviar a mensagem');
      suggestions.push('💬 Se persistir, entre em contato com o suporte');
  }
  
  return suggestions;
}

// Ícone baseado na fonte do erro
function getErrorSourceIcon(source: DeliveryDetail['errorSource']) {
  switch (source) {
    case 'evolution': return <Zap className="w-4 h-4" />;
    case 'whatsapp': return <Phone className="w-4 h-4" />;
    case 'validation': return <FileWarning className="w-4 h-4" />;
    case 'network': return <Server className="w-4 h-4" />;
    case 'server': return <Server className="w-4 h-4" />;
    default: return <HelpCircle className="w-4 h-4" />;
  }
}

// Label da fonte do erro
function getErrorSourceLabel(source: DeliveryDetail['errorSource']): string {
  switch (source) {
    case 'evolution': return 'Evolution API';
    case 'whatsapp': return 'WhatsApp';
    case 'validation': return 'Validação';
    case 'network': return 'Rede/Conexão';
    case 'server': return 'Servidor';
    default: return 'Desconhecido';
  }
}

// Cor do badge da fonte do erro
function getErrorSourceColor(source: DeliveryDetail['errorSource']): string {
  switch (source) {
    case 'evolution': return 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20';
    case 'whatsapp': return 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20';
    case 'validation': return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20';
    case 'network': return 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20';
    case 'server': return 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20';
    default: return 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20';
  }
}

export function CampaignDeliveryDetails({
  queueId,
  queueName,
  runId,
  contactsCount,
  onClose
}: CampaignDeliveryDetailsProps) {
  const [deliveries, setDeliveries] = useState<DeliveryDetail[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'success' | 'error'>('all');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [resendingIds, setResendingIds] = useState<Set<string>>(new Set());
  
  // Estado do perfil de conexão
  const [profileStatus, setProfileStatus] = useState<ProfileStatusResult | null>(null);
  const [isCheckingProfile, setIsCheckingProfile] = useState(true);

  // Verifica status do perfil de conexão
  const checkProfileConnection = useCallback(async () => {
    setIsCheckingProfile(true);
    try {
      console.log('[DeliveryDetails] 🔌 Verificando status do perfil para queue:', queueId);
      const status = await getCampaignProfileStatus(queueId);
      console.log('[DeliveryDetails] Status do perfil:', status);
      setProfileStatus(status);
    } catch (error) {
      console.error('[DeliveryDetails] Erro ao verificar perfil:', error);
      setProfileStatus({
        available: false,
        status: 'error',
        message: 'Erro ao verificar status do perfil'
      });
    } finally {
      setIsCheckingProfile(false);
    }
  }, [queueId]);

  // Verifica o perfil ao montar
  useEffect(() => {
    checkProfileConnection();
  }, [checkProfileConnection]);

  // Função para recarregar os dados
  const loadDeliveries = useCallback(async () => {
    setIsLoading(true);
    try {
      console.log('[DeliveryDetails] 📦 Carregando logs para queue:', queueId, 'runId:', runId);
      
      let logs: any[] = [];
      
      // Tenta buscar por run_id primeiro
      if (runId) {
        const result = await logsListForRun(runId);
        logs = result?.list || [];
        console.log('[DeliveryDetails] ✅ Logs por run_id:', logs.length);
      }
      
      // Se não encontrou, busca por queue_id
      if (logs.length === 0) {
        const result = await logsListByQueueId(queueId);
        logs = result?.list || [];
        console.log('[DeliveryDetails] ✅ Logs por queue_id:', logs.length);
      }

      // Agrupa logs por número (um número pode ter múltiplos logs/blocos)
      const numberMap = new Map<string, DeliveryDetail>();
      
      logs.forEach((log: any) => {
        const number = extractNumberFromLog(log);
        if (!number) return;
        
        const existing = numberMap.get(number);
        const isError = log.level === 'error';
        const isSuccess = log.level === 'success' || log.level === 'info' || 
                         log.http_status === 200 || log.http_status === 201;
        
        // Se já existe e tem sucesso, mantém sucesso (prioridade)
        if (existing && existing.status === 'success' && !isError) {
          return;
        }
        
        // Se é erro, processa detalhes
        let errorMessage = '';
        let errorSource: DeliveryDetail['errorSource'] = undefined;
        let suggestions: string[] = [];
        
        if (isError) {
          errorMessage = extractReasonFromLog(log);
          errorSource = determineErrorSource(log, errorMessage);
          suggestions = generateSuggestions(errorSource, errorMessage, log.http_status);
        }
        
        // Extrai nome do contato se disponível
        let contactName = '';
        try {
          const msgJson = typeof log.message_json === 'string' 
            ? JSON.parse(log.message_json) 
            : log.message_json;
          contactName = msgJson?.contact_name || msgJson?.name || log.contact_name || '';
        } catch {
          contactName = log.contact_name || '';
        }
        
        const delivery: DeliveryDetail = {
          id: String(log.Id || Date.now()),
          number,
          name: contactName || 'Contato',
          status: isError ? 'error' : isSuccess ? 'success' : 'pending',
          timestamp: log.CreatedAt || new Date().toISOString(),
          errorSource,
          errorMessage,
          errorCode: log.error_code,
          httpStatus: log.http_status,
          suggestions,
          rawLog: log,
          blockType: log.action || log.block_type || 'mensagem'
        };
        
        // Atualiza ou cria
        if (!existing || isError || (existing.status !== 'success' && isSuccess)) {
          numberMap.set(number, delivery);
        }
      });
      
      const deliveryList = Array.from(numberMap.values());
      
      // Ordena: erros primeiro, depois sucessos
      deliveryList.sort((a, b) => {
        if (a.status === 'error' && b.status !== 'error') return -1;
        if (a.status !== 'error' && b.status === 'error') return 1;
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });
      
      console.log('[DeliveryDetails] 📊 Total de entregas processadas:', deliveryList.length);
      console.log('[DeliveryDetails] ❌ Erros:', deliveryList.filter(d => d.status === 'error').length);
      console.log('[DeliveryDetails] ✅ Sucesso:', deliveryList.filter(d => d.status === 'success').length);
      
      setDeliveries(deliveryList);
    } catch (error) {
      console.error('[DeliveryDetails] ❌ Erro ao carregar logs:', error);
    } finally {
      setIsLoading(false);
    }
  }, [queueId, runId]);

  // Carrega os dados ao montar
  useEffect(() => {
    loadDeliveries();
  }, [loadDeliveries]);

  // Filtra entregas baseado no filtro selecionado
  const filteredDeliveries = useMemo(() => {
    if (filter === 'all') return deliveries;
    return deliveries.filter(d => d.status === filter);
  }, [deliveries, filter]);

  // Contadores
  const successCount = deliveries.filter(d => d.status === 'success').length;
  const errorCount = deliveries.filter(d => d.status === 'error').length;

  // Toggle expand/collapse
  const toggleExpand = (id: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Handler de reenvio individual
  const handleResendSingle = async (delivery: DeliveryDetail) => {
    // Verifica se o perfil está disponível antes de tentar reenviar
    if (!profileStatus?.available) {
      toast.error('Perfil de conexão indisponível. Verifique a conexão e tente novamente.');
      // Atualiza o status do perfil
      checkProfileConnection();
      return;
    }
    
    setResendingIds(prev => new Set(prev).add(delivery.id));
    
    try {
      console.log('[DeliveryDetails] 🔄 Iniciando reenvio para:', delivery.number);
      
      // skipProfileCheck=true pois já verificamos acima
      const result = await resendToContact(
        queueId,
        delivery.number,
        delivery.name,
        delivery.id,
        true // skipProfileCheck - já verificamos no componente
      );
      
      console.log('[DeliveryDetails] Resultado do reenvio:', result);
      
      if (result.success) {
        toast.success(result.message);
        
        // Atualiza o status na lista localmente
        setDeliveries(prev => prev.map(d => 
          d.id === delivery.id 
            ? { 
                ...d, 
                status: 'success' as const, 
                errorSource: undefined,
                errorMessage: undefined,
                suggestions: [],
                timestamp: new Date().toISOString()
              }
            : d
        ));
      } else {
        toast.error(result.message);
        
        // Verifica se o erro é de perfil indisponível
        if (result.message.includes('indisponível') || result.message.includes('desconectado')) {
          // Atualiza o status do perfil
          checkProfileConnection();
        }
        
        // Atualiza com as novas informações de erro
        if (result.errors.length > 0) {
          setDeliveries(prev => prev.map(d => 
            d.id === delivery.id 
              ? { 
                  ...d, 
                  errorMessage: result.errors.join('; '),
                  timestamp: new Date().toISOString()
                }
              : d
          ));
        }
      }
      
      // Recarrega os dados do servidor para garantir consistência
      setTimeout(() => {
        loadDeliveries();
      }, 1500);
      
    } catch (error: any) {
      console.error('[DeliveryDetails] ❌ Erro ao reenviar:', error);
      toast.error(`Erro ao reenviar: ${error.message}`);
    } finally {
      setResendingIds(prev => {
        const next = new Set(prev);
        next.delete(delivery.id);
        return next;
      });
    }
  };

  // Exportar detalhes para Excel
  const handleExportExcel = () => {
    const data = filteredDeliveries.map(d => ({
      'Nome': d.name,
      'Número': formatPhoneLocal(d.number),
      'Status': d.status === 'success' ? 'Enviado' : d.status === 'error' ? 'Erro' : 'Pendente',
      'Data/Hora': formatBRDateTime(d.timestamp),
      'Tipo de Erro': d.errorSource ? getErrorSourceLabel(d.errorSource) : '',
      'Mensagem de Erro': d.errorMessage || '',
      'HTTP Status': d.httpStatus || '',
      'Sugestões': d.suggestions.join(' | ')
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Detalhes');
    XLSX.writeFile(wb, `detalhes_${queueName.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.xlsx`);
  };

  return (
    <Card className="bg-card border-border">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              Detalhes de Envios
            </h3>
            <p className="text-sm text-muted-foreground">
              Campanha: <span className="font-medium">{queueName}</span>
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 mt-4 flex-wrap">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span className="text-sm font-medium">{successCount} enviados</span>
          </div>
          <div className="flex items-center gap-2">
            <XCircle className="h-4 w-4 text-red-500" />
            <span className="text-sm font-medium">{errorCount} erros</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              {contactsCount} contatos na campanha
            </span>
          </div>
        </div>

        {/* Status do Perfil de Conexão */}
        <div className="mt-3 p-3 rounded-lg border border-border bg-muted/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isCheckingProfile ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Verificando conexão...</span>
                </>
              ) : profileStatus?.available ? (
                <>
                  <Wifi className="h-4 w-4 text-green-500" />
                  <span className="text-sm text-green-600 dark:text-green-400 font-medium">
                    Perfil conectado
                  </span>
                  {profileStatus.instanceName && (
                    <Badge variant="outline" className="text-xs">
                      {profileStatus.instanceName}
                    </Badge>
                  )}
                </>
              ) : (
                <>
                  <WifiOff className="h-4 w-4 text-red-500" />
                  <span className="text-sm text-red-600 dark:text-red-400 font-medium">
                    Perfil indisponível
                  </span>
                  <span className="text-xs text-muted-foreground">
                    — {profileStatus?.message || 'Verifique a conexão'}
                  </span>
                </>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={checkProfileConnection}
              disabled={isCheckingProfile}
              className="h-7 px-2"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isCheckingProfile ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          {!profileStatus?.available && !isCheckingProfile && (
            <p className="text-xs text-muted-foreground mt-2">
              💡 O botão "Reenviar" ficará disponível quando o perfil estiver conectado.
            </p>
          )}
        </div>

        {/* Filters and Actions */}
        <div className="flex items-center justify-between mt-4">
          <div className="flex gap-2">
            <Button
              variant={filter === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('all')}
            >
              Todos ({deliveries.length})
            </Button>
            <Button
              variant={filter === 'success' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('success')}
              className={filter === 'success' ? '' : 'text-green-600 border-green-200 hover:bg-green-50 dark:text-green-400 dark:border-green-900 dark:hover:bg-green-950'}
            >
              <CheckCircle2 className="h-4 w-4 mr-1" />
              Enviados ({successCount})
            </Button>
            <Button
              variant={filter === 'error' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('error')}
              className={filter === 'error' ? '' : 'text-red-600 border-red-200 hover:bg-red-50 dark:text-red-400 dark:border-red-900 dark:hover:bg-red-950'}
            >
              <XCircle className="h-4 w-4 mr-1" />
              Erros ({errorCount})
            </Button>
          </div>
          <Button variant="outline" size="sm" onClick={handleExportExcel}>
            <Download className="h-4 w-4 mr-2" />
            Exportar Excel
          </Button>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="h-[500px]">
        <div className="p-4 space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex items-center gap-3">
                <RefreshCw className="h-5 w-5 animate-spin text-primary" />
                <span className="text-muted-foreground">Carregando detalhes dos envios...</span>
              </div>
            </div>
          ) : filteredDeliveries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertTriangle className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground">
                {filter === 'all' 
                  ? 'Nenhum registro de envio encontrado para esta campanha'
                  : filter === 'success'
                    ? 'Nenhum envio com sucesso encontrado'
                    : 'Nenhum erro encontrado'}
              </p>
            </div>
          ) : (
            filteredDeliveries.map((delivery) => (
              <Collapsible
                key={delivery.id}
                open={expandedItems.has(delivery.id)}
                onOpenChange={() => toggleExpand(delivery.id)}
              >
                <div className={`border rounded-lg transition-colors ${
                  delivery.status === 'error' 
                    ? 'border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/30' 
                    : 'border-border bg-card'
                }`}>
                  {/* Header do item */}
                  <CollapsibleTrigger className="w-full p-3 flex items-center justify-between hover:bg-muted/50 transition-colors rounded-t-lg">
                    <div className="flex items-center gap-3">
                      {/* Ícone de status */}
                      {delivery.status === 'success' ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                      ) : delivery.status === 'error' ? (
                        <XCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
                      ) : (
                        <Clock className="h-5 w-5 text-yellow-500 flex-shrink-0" />
                      )}
                      
                      {/* Informações do contato */}
                      <div className="text-left">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">
                            {delivery.name}
                          </span>
                          {delivery.errorSource && (
                            <Badge 
                              variant="outline" 
                              className={`text-xs ${getErrorSourceColor(delivery.errorSource)}`}
                            >
                              {getErrorSourceIcon(delivery.errorSource)}
                              <span className="ml-1">{getErrorSourceLabel(delivery.errorSource)}</span>
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Phone className="h-3 w-3" />
                          <span className="font-mono">{formatPhoneLocal(delivery.number)}</span>
                          <span>•</span>
                          <span>{formatBRDateTime(delivery.timestamp)}</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {/* Botão de reenvio para erros */}
                      {delivery.status === 'error' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleResendSingle(delivery);
                          }}
                          disabled={resendingIds.has(delivery.id) || !profileStatus?.available || isCheckingProfile}
                          className={`${
                            profileStatus?.available 
                              ? 'text-blue-600 border-blue-200 hover:bg-blue-50 dark:text-blue-400 dark:border-blue-900 dark:hover:bg-blue-950'
                              : 'text-muted-foreground border-muted opacity-60 cursor-not-allowed'
                          }`}
                          title={
                            !profileStatus?.available 
                              ? `Perfil indisponível: ${profileStatus?.message || 'Verifique a conexão'}` 
                              : 'Reenviar mensagem'
                          }
                        >
                          <RefreshCw className={`h-4 w-4 mr-1 ${resendingIds.has(delivery.id) ? 'animate-spin' : ''}`} />
                          {resendingIds.has(delivery.id) 
                            ? 'Reenviando...' 
                            : isCheckingProfile 
                              ? 'Verificando...' 
                              : !profileStatus?.available 
                                ? 'Indisponível' 
                                : 'Reenviar'}
                        </Button>
                      )}
                      
                      {/* Indicador de expandir */}
                      {delivery.status === 'error' && (
                        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${
                          expandedItems.has(delivery.id) ? 'rotate-180' : ''
                        }`} />
                      )}
                    </div>
                  </CollapsibleTrigger>

                  {/* Detalhes expandidos (apenas para erros) */}
                  {delivery.status === 'error' && (
                    <CollapsibleContent>
                      <div className="p-4 pt-0 space-y-4 border-t border-red-200 dark:border-red-900">
                        {/* Mensagem de erro */}
                        <div className="bg-red-100 dark:bg-red-950/50 rounded-lg p-3">
                          <div className="text-sm font-medium text-red-800 dark:text-red-300 mb-1">
                            Mensagem de Erro:
                          </div>
                          <div className="text-sm text-red-700 dark:text-red-400 font-mono break-all">
                            {delivery.errorMessage || 'Erro desconhecido'}
                          </div>
                          {delivery.httpStatus && delivery.httpStatus >= 400 && (
                            <div className="mt-2">
                              <Badge variant="destructive" className="text-xs">
                                HTTP {delivery.httpStatus}
                              </Badge>
                            </div>
                          )}
                        </div>

                        {/* Sugestões */}
                        {delivery.suggestions.length > 0 && (
                          <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3">
                            <div className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-2">
                              💡 Sugestões de Resolução:
                            </div>
                            <ul className="space-y-1">
                              {delivery.suggestions.map((suggestion, idx) => (
                                <li key={idx} className="text-sm text-blue-700 dark:text-blue-400">
                                  {suggestion}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Detalhes técnicos (colapsável) */}
                        <Collapsible>
                          <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
                            <ChevronDown className="h-3 w-3" />
                            Ver detalhes técnicos completos
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <pre className="mt-2 p-3 bg-muted rounded-lg text-xs overflow-auto max-h-48 font-mono">
                              {JSON.stringify(delivery.rawLog, null, 2)}
                            </pre>
                          </CollapsibleContent>
                        </Collapsible>
                      </div>
                    </CollapsibleContent>
                  )}
                </div>
              </Collapsible>
            ))
          )}
        </div>
      </ScrollArea>
    </Card>
  );
}
