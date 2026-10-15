import { isWallpaper } from './wallpaper';
import { loadDocumentCatalog } from './document-api';
import { archiveRecords, documentColumns } from './document-archive';
import { installDocumentArchive } from './data';

async function boot() {
  const enabled =
    !isWallpaper && (import.meta.env.DEV || import.meta.env.VITE_APEX_ENABLED === 'true');
  if (enabled && new URLSearchParams(location.search).get('library') === 'documents') {
    const stage = document.querySelector<HTMLElement>('#stage')!;
    const status = document.createElement('div');
    status.style.cssText =
      'position:fixed;inset:0;display:grid;place-content:center;gap:20px;padding:32px;background:#e8e5e1;color:#181a18;font:16px system-ui;z-index:100;';
    status.textContent = '正在读取真实档案…';
    stage.append(status);
    try {
      installDocumentArchive(archiveRecords(await loadDocumentCatalog()), documentColumns);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : '文档连接失败，请重试。';
      const retry = document.createElement('button');
      retry.textContent = '重新连接';
      retry.onclick = () => location.reload();
      const demo = document.createElement('a');
      demo.href = '/';
      demo.textContent = '返回演示档案';
      status.append(retry, demo);
      return;
    }
  }
  await import('./main');
}
void boot();
