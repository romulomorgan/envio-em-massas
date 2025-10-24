import React from 'react';

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="card-custom p-6 md:p-8">
          <h1 className="text-3xl font-bold mb-2">Envio em Massa</h1>
          <p className="text-muted-foreground mb-6">
            Sistema de envio em massa para WhatsApp com integração Chatwoot, NocoDB e Supabase
          </p>
          
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
            <p className="text-sm text-yellow-800">
              <strong>⚠️ Implementação em andamento...</strong>
              <br />
              O sistema completo está sendo migrado do HTML para React + TypeScript.
              Esta é uma aplicação complexa com 3500+ linhas de código que será recriada mantendo todas as funcionalidades originais.
            </p>
          </div>

          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="card-custom p-4">
              <div className="text-2xl mb-2">📋</div>
              <h3 className="font-semibold mb-1">Gestão de Contatos</h3>
              <p className="text-sm text-muted-foreground">
                Importar CSV/XLSX, buscar por etiquetas, empreendimentos e grupos do WhatsApp
              </p>
            </div>

            <div className="card-custom p-4">
              <div className="text-2xl mb-2">✉️</div>
              <h3 className="font-semibold mb-1">Composição de Mensagens</h3>
              <p className="text-sm text-muted-foreground">
                Texto, imagem, áudio, vídeo, documento, link, lista e enquete
              </p>
            </div>

            <div className="card-custom p-4">
              <div className="text-2xl mb-2">📊</div>
              <h3 className="font-semibold mb-1">Monitor de Campanhas</h3>
              <p className="text-sm text-muted-foreground">
                Acompanhe, pause, retome e exporte logs de envio em tempo real
              </p>
            </div>

            <div className="card-custom p-4">
              <div className="text-2xl mb-2">⏰</div>
              <h3 className="font-semibold mb-1">Agendamento Inteligente</h3>
              <p className="text-sm text-muted-foreground">
                Delays configuráveis entre itens e contatos com variação aleatória
              </p>
            </div>

            <div className="card-custom p-4">
              <div className="text-2xl mb-2">📱</div>
              <h3 className="font-semibold mb-1">Preview WhatsApp</h3>
              <p className="text-sm text-muted-foreground">
                Visualize como suas mensagens aparecerão no WhatsApp
              </p>
            </div>

            <div className="card-custom p-4">
              <div className="text-2xl mb-2">🔗</div>
              <h3 className="font-semibold mb-1">Integrações</h3>
              <p className="text-sm text-muted-foreground">
                Chatwoot, NocoDB e Supabase totalmente integrados
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
