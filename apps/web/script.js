// 전역 변수
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let recordingTimer = null;
let startTime = 0;
let currentAudioFile = null;
let sessionHistory = [];
let projects = {};
let openTabs = new Map(); // 열려있는 탭들
let activeTabId = 'welcome';
let tabCounter = 1;

// VS Code 스타일 파일 시스템 시뮬레이션
let fileSystem = {
    '/': {
        type: 'folder',
        name: '강의 요약 프로젝트',
        children: {
            'recordings': {
                type: 'folder',
                name: '녹음 파일',
                children: {}
            },
            'summaries': {
                type: 'folder',
                name: '요약 파일',
                children: {}
            }
        }
    }
};

// DOM이 로드되면 실행
document.addEventListener('DOMContentLoaded', function() {
    console.log('강의 요약 AI가 로드되었습니다.');

    initializeApp();
    loadSessionHistory();
    loadProjects();
    initializeTabs();
    setupSidebarTabs();

    switchSidebarPanel('summaries');
    renderProjects();
});

// 앱 초기화
function initializeApp() {
    checkMicrophonePermission();
    setupEventListeners();
    updateSummariesList();
    
    console.log('앱이 초기화되었습니다.');
}

// 탭 시스템 초기화
function initializeTabs() {
    openTabs.set('welcome', {
        id: 'welcome',
        title: '시작하기',
        type: 'welcome',
        icon: 'fas fa-home',
        closable: false
    });
    
    updateTabBar();
}

// 사이드바 탭 설정
function setupSidebarTabs() {
    const sidebarTabs = document.querySelectorAll('.sidebar-tab');
    
    sidebarTabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const panelId = this.dataset.panel;
            switchSidebarPanel(panelId);
        });
    });
}

// 사이드바 토글 버튼
function toggleSidebarMini() {
    const sidebar = document.querySelector('.sidebar');
    const btn = document.querySelector('.sidebar-toggle-btn');
    const icon = btn.querySelector('i');

    sidebar.classList.toggle('mini');

    // 아이콘 방향 전환
    if (sidebar.classList.contains('mini')) {
        icon.classList.remove('fa-chevron-left');
        icon.classList.add('fa-chevron-right');
    } else {
        icon.classList.remove('fa-chevron-right');
        icon.classList.add('fa-chevron-left');
    }
}

// 사이드바 패널 전환
function switchSidebarPanel(panelId) {
    // 탭 활성화 상태 변경
    document.querySelectorAll('.sidebar-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelector(`[data-panel="${panelId}"]`).classList.add('active');
    
    // 패널 표시 변경
    document.querySelectorAll('.sidebar-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    document.getElementById(`${panelId}-panel`).classList.add('active');
}

// 마이크 권한 확인
async function checkMicrophonePermission() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        console.log('마이크 권한이 허용되었습니다.');
    } catch (error) {
        console.error('마이크 권한이 거부되었습니다:', error);
        showNotification('error', '마이크 권한이 필요합니다. 브라우저 설정에서 마이크 권한을 허용해주세요.');
    }
}

function setupEventListeners() {
    // 키보드 단축키
    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey || e.metaKey) {
            switch(e.key) {
                case 'n':
                    e.preventDefault();
                    showNewFileMenu();
                    break;
                case 'w':
                    e.preventDefault();
                    closeActiveTab();
                    break;
                case 't':
                    e.preventDefault();
                    startRecording();
                    break;
            }
        }
        
        // ESC 키로 모달 닫기
        if (e.key === 'Escape') {
            closeRecordingModal();
        }
    });

    // 클릭 이벤트로 메뉴 닫기
    document.addEventListener('click', function(e) {
        const newFileMenu = document.getElementById('newFileMenu');
        const newFileBtn = document.querySelector('.new-file-btn');
    });
}


// 실시간 녹음 시작
function startRecording() {
    showRecordingModal('recording');
}

function resetRecordingUI() {
  const statusText = document.querySelector('#recordingStatus .status-text');
  const timer = document.getElementById('recordingTimer');
  if (statusText) statusText.textContent = '준비됨';
  if (timer) {
    timer.classList.remove('active');
    timer.textContent = '00:00';
  }
}

// 파일 업로드 시작
function uploadFile() {
    showRecordingModal('upload');
}

// 녹음 모달 표시
function showRecordingModal(type) {
    const modal = document.getElementById('recordingModal');
    const title = document.getElementById('modalTitle');
    const recordingControls = document.getElementById('recordingControls');
    const uploadControls = document.getElementById('uploadControls');
    
    if (type === 'recording') {
        title.textContent = '실시간 녹음';
        recordingControls.style.display = 'block';
        uploadControls.style.display = 'none';
    } else {
        title.textContent = '파일 업로드';
        recordingControls.style.display = 'none';
        uploadControls.style.display = 'block';
    }
    
    modal.classList.add('show');
    disableSummarizeButton();
    resetRecordingUI();
}

// 녹음 모달 닫기
function closeRecordingModal(keepState = false) {
  const modal = document.getElementById('recordingModal');
  modal.classList.remove('show');

  // 녹음 중이면 중지
  if (isRecording) {
    toggleRecording();
  }

  // 상태 초기화 (요약 버튼에서 닫을 때는 keepState=true로 상태 유지)
  if (!keepState) {
    currentAudioFile = null;
    disableSummarizeButton();
    const fileInput = document.getElementById('audioFile');
    if (fileInput) fileInput.value = '';
  }
}

// 실시간 녹음 토글
async function toggleRecording() {
    const recordBtn = document.getElementById('recordBtn');
    const recordingStatus = document.getElementById('recordingStatus');
    const statusText = recordingStatus.querySelector('.status-text');
    const timer = document.getElementById('recordingTimer');
    
    if (!isRecording) {
        try {
            clearInterval(recordingTimer);
            document.getElementById('recordingTimer').textContent = '00:00';

            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    sampleRate: 44100,
                    channelCount: 1,
                    volume: 1.0
                }
            });
            
            mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus'
            });
            
            recordedChunks = [];
            
            mediaRecorder.ondataavailable = function(event) {
                if (event.data.size > 0) {
                    recordedChunks.push(event.data);
                }
            };
            
            mediaRecorder.onstop = function() {
                const audioBlob = new Blob(recordedChunks, { type: 'audio/webm' });
                currentAudioFile = audioBlob;
                enableSummarizeButton();
                
                showNotification('success', '녹음이 완료되었습니다!');
            };
            
            mediaRecorder.start();
            isRecording = true;
            startTime = Date.now();
            
            // UI 업데이트
            recordBtn.classList.add('recording');
            recordBtn.innerHTML = '<i class="fas fa-stop"></i><span>녹음 중지</span>';
            timer.classList.remove('active');
            timer.textContent = '00:00';
            
            // 타이머 시작
            recordingTimer = setInterval(updateTimer, 1000);
            
        } catch (error) {
            console.error('녹음 시작 실패:', error);
            showNotification('error', '녹음을 시작할 수 없습니다. 마이크 권한을 확인해주세요.');
        }
    } else {
        // 녹음 중지
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
        
        isRecording = false;
        clearInterval(recordingTimer);
        
        // UI 업데이트
        recordBtn.classList.remove('recording');
        recordBtn.innerHTML = '<i class="fas fa-microphone"></i><span>녹음 시작</span>';
        statusText.textContent = '완료됨';
        timer.classList.remove('active');
    }
}

// 녹음 타이머 업데이트
function updateTimer() {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    
    const timer = document.getElementById('recordingTimer');
    timer.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// 파일 업로드 처리
function handleFileUpload(event) {
    const file = event.target.files[0];
    
    if (!file) return;
    
    if (!file.type.startsWith('audio/')) {
        showNotification('error', '오디오 파일만 업로드할 수 있습니다.');
        return;
    }
    
    if (file.size > 100 * 1024 * 1024) {
        showNotification('error', '파일 크기는 100MB 이하여야 합니다.');
        return;
    }
    
    currentAudioFile = file;
    enableSummarizeButton();
    
    showNotification('success', `파일 "${file.name}"이 업로드되었습니다.`);
}

// 요약 생성
async function summarizeAudio() {
  if (!currentAudioFile) {
    showNotification('error', '먼저 오디오를 녹음하거나 파일을 업로드해주세요.');
    return;
  }

  //버튼 누르자마자 모달 닫기(상태는 유지)
  closeRecordingModal(true);

  showLoading(true);
  try {
    await simulateSummarization();
    // (이미 모달은 닫힌 상태이므로 여긴 다시 닫을 필요 없음)
  } catch (error) {
    console.error('요약 실패:', error);
    showNotification('error', '요약 중 오류가 발생했습니다. 다시 시도해주세요.');
  } finally {
    showLoading(false);
  }
}


// 요약 시뮬레이션
async function simulateSummarization() {
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const timestamp = new Date();
    const fileObj = normalizeAudioFile(currentAudioFile);
    const fileName = fileObj instanceof File ? fileObj.name : `recording_${timestamp.getTime()}.webm`;
    // 재생용 오브젝트 URL 생성
    const audioUrl = URL.createObjectURL(fileObj);
    const summary = {
        id: Date.now(),
        title: `${fileName} 요약`,
        fileName: fileName,
        content: generateMockSummary(),
        timestamp: timestamp.toLocaleString('ko-KR'),
        type: currentAudioFile instanceof File ? 'file' : 'recording',
        // 👇 전체 텍스트 섹션에서 사용할 재생 정보
        audioUrl,
        mimeType: fileObj.type || 'audio/webm',
        fileSize: fileObj.size || 0
    };
    
    // 탭으로 요약 결과 표시
    createSummaryTab(summary);
    
    // 파일 시스템에 추가
    addToFileSystem(summary);
    
    // 히스토리에 추가
    addToHistory(summary);
    
    // UI 업데이트
    if (document.getElementById('recordingsFolder') || document.getElementById('summariesFolder')) {
        updateFileTree();
    }   
    updateSummariesList();
    updateRecentItems();
}

// 모의 요약 내용 생성
function generateMockSummary() {
    return `# 강의 요약

## 📝 주요 내용

### 1. 핵심 개념
- **개념 A**: 강의의 첫 번째 주요 개념에 대한 상세한 설명
- **개념 B**: 두 번째 핵심 개념과 실제 적용 방법
- **개념 C**: 세 번째 개념과 이전 개념들과의 연관성

### 2. 실습 내용
1. 기본 설정 및 환경 구성
2. 단계별 실습 진행
3. 결과 확인 및 검증

### 3. 중요 포인트
> 💡 **핵심 메시지**: 이 강의에서 가장 중요한 포인트

- ⚠️ 주의사항: 실습 시 반드시 확인해야 할 사항들
- 📌 팁: 효율적인 학습을 위한 추가 팁들

## 📚 추가 학습 자료

### 참고 문서
- 관련 문서 1
- 관련 문서 2
- 온라인 리소스

### 실습 과제
1. 기본 과제: 강의 내용 복습
2. 심화 과제: 응용 문제 해결
3. 프로젝트: 실제 적용 사례 개발

## 🔗 키워드
\`#강의요약\` \`#학습\` \`#실습\` \`#핵심개념\`

---
*이 요약은 AI에 의해 자동 생성되었습니다.*`;
}

// 요약 탭 생성
function createSummaryTab(summary) {
    const tabId = `summary_${summary.id}`;
    
    // 탭 정보 저장
    openTabs.set(tabId, {
        id: tabId,
        title: summary.title,
        type: 'summary',
        icon: 'fas fa-file-alt',
        closable: true,
        data: summary
    });
    
    // 탭 콘텐츠 생성
    createTabContent(tabId, summary);
    
    // 탭으로 전환
    switchToTab(tabId);
    
    // 탭 바 업데이트
    updateTabBar();
}

// 탭 콘텐츠 생성
function createTabContent(tabId, summary) {
    const tabContents = document.querySelector('.tab-contents');
    const tabContent = document.createElement('div');
    tabContent.className = 'tab-content';
    tabContent.id = `${tabId}-content`;

    // result 섹션 (요약/화자 구분/전체 텍스트 전환 UI)
    tabContent.innerHTML = `
    <div class="summary-viewer">
      <div class="summary-header">
        <div class="summary-meta">
          <h1>${summary.title}</h1>
          <div class="summary-info">
            <span class="summary-type">
              <i class="fas ${summary.type === 'file' ? 'fa-file-audio' : 'fa-microphone'}"></i>
              ${summary.type === 'file' ? '파일 업로드' : '실시간 녹음'}
            </span>
            <span class="summary-date">${summary.timestamp}</span>
          </div>
        </div>
        <div class="summary-actions">
          <button class="action-btn" onclick="exportSummary('${tabId}')" title="내보내기">
            <i class="fas fa-download"></i>
          </button>
          <button class="action-btn" onclick="copySummary('${tabId}')" title="복사">
            <i class="fas fa-copy"></i>
          </button>
        </div>
      </div>

      <section class="result">
        <div class="result-row">
          <button class="btn active" id="show-summary-${tabId}" onclick="showResult('${tabId}','summary')">요약본</button>
          <button class="btn" id="show-raw-${tabId}" onclick="showResult('${tabId}','raw')">화자 구분</button>
          <button class="btn" id="show-plain-${tabId}" onclick="showResult('${tabId}','plain')">오디오 파일</button>
        </div>
        <div id="output-${tabId}" class="resultbox">
          ${markdownToHtml(summary.content)}
        </div>
      </section>
    </div>
    `;

    tabContents.appendChild(tabContent);
}

function showResult(tabId, type) {
    const output = document.getElementById(`output-${tabId}`);
    const tabMeta = openTabs.get(tabId);
    const summary = tabMeta?.data;
    const btns = [
        document.getElementById(`show-summary-${tabId}`),
        document.getElementById(`show-raw-${tabId}`),
        document.getElementById(`show-plain-${tabId}`)
    ];
    btns.forEach(btn => btn.classList.remove('active'));

    switch (type) {
        // 더미 데이터(추후 API 연결 예정)
        case 'summary':
            btns[0].classList.add('active');
            output.innerHTML = `
                <div class="content-body">
                    ${markdownToHtml(generateMockSummary())}
                </div>
                <div class="copy-row">
                    <button class="btn copy-btn" onclick="copyResultText('${tabId}')" title="텍스트 복사">
                        <i class="fas fa-copy"></i><span>&nbsp;텍스트 복사</span>
                    </button>
                </div>
            `;
            break;
        case 'raw':
            btns[1].classList.add('active');
            output.innerHTML = `
                <div class="content-body">
                    <p><strong>[화자1]</strong> HTML은 프로그래밍 언어인가요?<br><strong>[화자2]</strong> 네.</p>
                </div>
                <div class="copy-row">
                    <button class="btn copy-btn" onclick="copyResultText('${tabId}')" title="텍스트 복사">
                        <i class="fas fa-copy"></i><span>&nbsp;텍스트 복사</span>
                    </button>
                </div>
            `;
            break;
        case 'plain':
            btns[2].classList.add('active');
            if (summary?.audioUrl) {
                const niceSize = summary.fileSize ? ` (${(summary.fileSize/1024/1024).toFixed(1)} MB)` : '';
                output.innerHTML = `
                    <div class="audio-player">
                        <audio controls src="${summary.audioUrl}"></audio>
                        <div class="audio-meta">
                            <i class="fas fa-file-audio"></i>
                            <span>${summary.fileName}${niceSize}</span>
                            <a class="audio-download" href="${summary.audioUrl}" download="${summary.fileName}">다운로드</a>
                        </div>
                    </div>
                `;
        } else {
            output.innerHTML = `
                <div class="audio-missing">
                    <i class="fas fa-info-circle"></i>
                    <span>이 세션에 연결된 오디오 파일이 없습니다.<br>새로 요약을 생성하면 재생기가 표시됩니다.</span>
                </div>
            `;
        }
        break;
    }
}

// 간단한 마크다운 to HTML 변환
function markdownToHtml(markdown) {
    return markdown
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>')
        .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
        .replace(/\*(.*)\*/gim, '<em>$1</em>')
        .replace(/`(.*)`/gim, '<code>$1</code>')
        .replace(/^\- (.*$)/gim, '<li>$1</li>')
        .replace(/^\d+\. (.*$)/gim, '<li>$1</li>')
        .replace(/\n/gim, '<br>');
}

// 탭 전환
function switchToTab(tabId) {
    // 모든 탭 콘텐츠 숨기기
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    // 선택된 탭 콘텐츠 표시
    const targetContent = document.getElementById(`${tabId}-content`);
    if (targetContent) {
        targetContent.classList.add('active');
    }
    
    activeTabId = tabId;
    updateTabBar();
}

// 탭 바 업데이트
function updateTabBar() {
    const tabBar = document.getElementById('tabBar');
    tabBar.innerHTML = '';
    
    openTabs.forEach((tab, tabId) => {
        const tabElement = document.createElement('div');
        tabElement.className = `tab ${tabId === activeTabId ? 'active' : ''}`;
        tabElement.dataset.tabId = tabId;
        
        tabElement.innerHTML = `
            <span class="tab-title">${tab.title}</span>
            ${tab.closable ? 
                `<i class="fas fa-times tab-close" onclick="closeTab('${tabId}', event)"></i>` :
                `<i class="${tab.icon} tab-icon"></i>`
            }
        `;
        
        tabElement.addEventListener('click', (e) => {
            if (!e.target.classList.contains('tab-close')) {
                switchToTab(tabId);
            }
        });
        
        tabBar.appendChild(tabElement);
    });
}

// 탭 닫기
function closeTab(tabId, event) {
    if (event) event.stopPropagation();
    
    // 탭 정보 제거
    openTabs.delete(tabId);
    
    // 탭 콘텐츠 제거
    const tabContent = document.getElementById(`${tabId}-content`);
    if (tabContent) {
        tabContent.remove();
    }
    
    // 활성 탭이 닫힌 경우 다른 탭으로 전환
    if (tabId === activeTabId) {
        const remainingTabs = Array.from(openTabs.keys());
        if (remainingTabs.length > 0) {
            switchToTab(remainingTabs[0]);
        }
    }
    
    updateTabBar();
}

// 활성 탭 닫기
function closeActiveTab() {
    const activeTab = openTabs.get(activeTabId);
    if (activeTab && activeTab.closable) {
        closeTab(activeTabId);
    }
}

// 파일 시스템에 추가
function addToFileSystem(summary) {
    const folderPath = summary.type === 'file' ? '/recordings' : '/summaries';
    const folder = fileSystem['/'].children[folderPath.substring(1)];
    
    folder.children[summary.fileName] = {
        type: 'file',
        name: summary.fileName,
        summary: summary,
        extension: summary.type === 'file' ? 'audio' : 'md'
    };
}

// 폴더 DOM이 없으면 스킵
function updateFileTree() {
  const rec = document.getElementById('recordingsFolder');
  const sum = document.getElementById('summariesFolder');
  if (!rec && !sum) return;
  if (rec) updateFolderContents('recordingsFolder', fileSystem['/'].children.recordings.children);
  if (sum) updateFolderContents('summariesFolder', fileSystem['/'].children.summaries.children);
}

function updateFolderContents(folderId, children) {
  const folder = document.getElementById(folderId);
  if (!folder) return; // 안전 가드
  folder.innerHTML = '';
  Object.values(children).forEach(item => {
    const itemElement = document.createElement('div');
    itemElement.className = 'tree-node file';
    const icon = item.extension === 'audio' ? 'fa-file-audio' : 'fa-file-alt';
    itemElement.innerHTML = `
      <div class="tree-node-content" onclick="openFile('${item.name}', '${item.extension}')">
        <i class="fas ${icon}"></i>
        <span>${item.name}</span>
      </div>
    `;
    folder.appendChild(itemElement);
  });
}

// 폴더 토글
function toggleFolder(element) {
    const treeNode = element.closest('.tree-node');
    treeNode.classList.toggle('expanded');
}

// 파일 열기
function openFile(fileName, extension) {
    // 파일에서 요약 찾기
    let summary = null;
    
    Object.values(fileSystem['/'].children).forEach(folder => {
        Object.values(folder.children).forEach(file => {
            if (file.name === fileName && file.summary) {
                summary = file.summary;
            }
        });
    });
    
    if (summary) {
        const tabId = `summary_${summary.id}`;
        
        // 이미 열려있는 탭인지 확인
        if (openTabs.has(tabId)) {
            switchToTab(tabId);
        } else {
            createSummaryTab(summary);
        }
    }
}

// 히스토리에 추가
function addToHistory(summary) {
    sessionHistory.unshift(summary);
    
    if (sessionHistory.length > 20) {
        sessionHistory = sessionHistory.slice(0, 20);
    }
    
    saveSessionHistory();
    updateSummariesList();
    updateRecentItems();
}

// 프로젝트 저장
function saveProjects() {
  try {
    localStorage.setItem('vscode_lectureAI_projects_v2', JSON.stringify(projects));
  } catch (e) { console.error('프로젝트 저장 실패', e); }
}

// 프로젝트 불러오기
function loadProjects() {
  try {
    const saved = localStorage.getItem('vscode_lectureAI_projects_v2');
    projects = saved ? JSON.parse(saved) : {};
  } catch (e) { projects = {}; }
}

// 프로젝트 ID 생성/검사, 할당 여부
function slugify(name){
  return name.toLowerCase().trim().replace(/[^\w\-]+/g,'-').replace(/\-+/g,'-');
}
function isAssigned(summaryId){
  return Object.values(projects).some(p => Array.isArray(p.items) && p.items.includes(summaryId));
}

// 프로젝트 생성
function createProjectFolder(){
  const name = (prompt('프로젝트 폴더 이름', '새 프로젝트') || '').trim();
  if (!name) return;
  let id = slugify(name) || `p_${Date.now()}`;
  if (projects[id]) { id = `${id}-${Date.now()}`; }
  projects[id] = { name, items: [], expanded: true };
  saveProjects(); renderProjects();
}

// 프로젝트 이름 바꾸기
function renameProjectFolder(id, e){
  if (e) e.stopPropagation();
  const folder = projects[id]; if (!folder) return;
  const nm = prompt('새 폴더 이름', folder.name);
  if (nm === null) return;
  const name = nm.trim(); if (!name) return;
  folder.name = name;
  saveProjects(); renderProjects();
}

// 프로젝트 삭제
function deleteProjectFolder(id, e){
    if (e) e.stopPropagation();
    const folder = projects[id];
    if (!folder) return;
    if (!confirm(`"${folder.name}" 폴더와 그 안의 모든 요약을 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;

    // 폴더 안의 요약들을 먼저 하드 삭제
    const toDelete = Array.isArray(folder.items) ? [...folder.items] : [];
    toDelete.forEach(hardDeleteSummaryById);

    // 폴더 제거
    delete projects[id];
    saveProjects();
    renderProjects();
    updateSummariesList();
    updateRecentItems();
    saveSessionHistory();
    showNotification('success','폴더와 내부 요약이 모두 삭제되었습니다.');
}

// 사이드바에서 개별 삭제에 쓰는 로직을 재사용하기 위한 내부 헬퍼
function hardDeleteSummaryById(id){
  const idx = findSummaryIndexById(id);
  if (idx === -1) return;
  const summary = sessionHistory[idx];
  // 1) 히스토리에서 제거
    sessionHistory.splice(idx, 1);
  // 2) 파일시스템에서 제거
  removeFromFileSystem(summary);
  // 3) 열려있는 탭 닫기
  const tabId = `summary_${summary.id}`;
  if (openTabs.has(tabId)) {
    closeTab(tabId);
  }
}


// 드래그 방식으로 프로젝트로 요약본 옮기기
function addSummaryToProject(folderId, summaryId){
  const folder = projects[folderId]; if (!folder) return;
  if (!folder.items) folder.items = [];
  // 중복 방지
  if (!folder.items.includes(summaryId)){
    folder.items.push(summaryId);
    // 다른 폴더에 이미 있던 경우 제거(= ‘이동’ 보장)
    Object.entries(projects).forEach(([id, f])=>{
      if (id!==folderId && Array.isArray(f.items)) {
        f.items = f.items.filter(x => x!==summaryId);
      }
    });
    saveProjects();
    renderProjects();          // 폴더 내부 반영
    updateSummariesList();     // 아래 ‘요약본(미지정)’에서 제거
    showNotification('success','프로젝트로 이동했습니다.');
  }
}

// 프로젝트 트리 렌더
function renderProjects(){
  const wrap = document.getElementById('projectsList');
  if (!wrap) return;
  wrap.innerHTML = '';
  Object.entries(projects).forEach(([id, p])=>{
    const node = document.createElement('div');
    node.className = `tree-node folder ${p.expanded?'expanded':''}`;
    node.innerHTML = `
      <div class="tree-node-content" data-folder-id="${id}">
        <i class="fas fa-folder"></i>
        <span class="folder-name">${p.name}</span>
        <div class="node-actions">
          <button class="icon" title="이름 변경" onclick="renameProjectFolder('${id}', event)"><i class="fas fa-pen"></i></button>
          <button class="icon" title="삭제" onclick="deleteProjectFolder('${id}', event)"><i class="fas fa-trash"></i></button>
        </div>
      </div>
      <div class="tree-children"></div>
    `;
    const header = node.querySelector('.tree-node-content');
    header.addEventListener('click', (e)=>{
      // 액션버튼 누른 경우는 토글 막기
      if (e.target.closest('.node-actions')) return;
      p.expanded = !p.expanded; node.classList.toggle('expanded'); saveProjects();
    });
    // 드롭 타깃
    header.addEventListener('dragover', (e)=>{ e.preventDefault(); header.classList.add('drop-target'); });
    header.addEventListener('dragleave', ()=> header.classList.remove('drop-target'));
    header.addEventListener('drop', (e)=>{
      e.preventDefault(); header.classList.remove('drop-target');
      const sid = Number(e.dataTransfer.getData('text/summaryId'));
      if (sid) addSummaryToProject(id, sid);
    });

    // 자식 요약 렌더
    const box = node.querySelector('.tree-children');
    (p.items||[]).forEach(sid=>{
      const s = sessionHistory.find(x=>x.id===sid);
      if (!s) return;
      const item = document.createElement('div');
      item.className = 'tree-node file';
      item.innerHTML = `
        <div class="tree-node-content">
          <i class="fas fa-file-alt"></i>
          <span>${s.title}</span>
        </div>`;
      item.querySelector('.tree-node-content').addEventListener('click', ()=> openSummaryFromHistory(s));
      box.appendChild(item);
    });

    wrap.appendChild(node);
  });
}

// 요약 리스트 업데이트
function updateSummariesList() {
  const summariesList = document.getElementById('summariesList');

  if (sessionHistory.length === 0) {
    summariesList.innerHTML = '<p style="text-align: center; color: #8c8c8c; padding: 20px;">아직 요약 기록이 없습니다.</p>';
    return;
  }

  summariesList.innerHTML = '';

  sessionHistory.forEach(summary => {
    // 이미 어떤 프로젝트 폴더에 들어간 요약은 아래 리스트에서 숨김
    if (isAssigned(summary.id)) return;
    const summaryElement = document.createElement('div');
    summaryElement.className = 'summary-item';
    summaryElement.onclick = () => openSummaryFromHistory(summary);
    // 폴더로 이동시키기 위해 드래그 가능
    summaryElement.draggable = true;
    summaryElement.addEventListener('dragstart', (e)=>{
        e.dataTransfer.setData('text/summaryId', String(summary.id));
    });

    summaryElement.innerHTML = `
      <h4 title="${summary.title}">${summary.title}</h4>
      <p>${summary.type === 'file' ? '파일 업로드' : '실시간 녹음'}</p>
      <div class="summary-date">${summary.timestamp}</div>

      <div class="summary-actions">
        <button class="icon-btn" title="이름 바꾸기" onclick="renameSummary(${summary.id}, event)">
          <i class="fas fa-pen"></i>
        </button>
        <button class="icon-btn" title="삭제" onclick="deleteSummary(${summary.id}, event)">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    `;

    summariesList.appendChild(summaryElement);
  });
}

// 히스토리에서 요약 열기
function openSummaryFromHistory(summary) {
    const tabId = `summary_${summary.id}`;
    
    if (openTabs.has(tabId)) {
        switchToTab(tabId);
    } else {
        createSummaryTab(summary);
    }
}

// 최근 항목 업데이트
function updateRecentItems() {
    const recentItems = document.getElementById('recentItems');
    const recentSummaries = sessionHistory.slice(0, 3);
    
    if (recentSummaries.length === 0) {
        recentItems.innerHTML = '<p style="text-align: center; color: #8c8c8c;">최근 요약이 없습니다.</p>';
        return;
    }
    
    recentItems.innerHTML = '';
    
    recentSummaries.forEach(summary => {
        const itemElement = document.createElement('div');
        itemElement.className = 'recent-item';
        itemElement.onclick = () => openSummaryFromHistory(summary);
        
        itemElement.innerHTML = `
            <h4>${summary.title}</h4>
            <p>${summary.timestamp} | ${summary.type === 'file' ? '파일 업로드' : '실시간 녹음'}</p>
        `;
        
        recentItems.appendChild(itemElement);
    });
}

// 요약 새로고침
function refreshSummaries() {
    updateSummariesList();
    showNotification('success', '요약 목록이 새로고침되었습니다.');
}

// 요약 ID로 배열 인덱스 찾기
function findSummaryIndexById(id) {
  return sessionHistory.findIndex(s => s.id === id);
}

// 탭 제목도 같이 갱신
function updateOpenTabTitle(summaryId, newTitle) {
  const tabId = `summary_${summaryId}`;
  const tab = openTabs.get(tabId);
  if (tab) {
    tab.title = newTitle;
    // 이미 그 탭 DOM이 있다면 즉시 반영
    updateTabBar();
    const headerH1 = document.querySelector(`#${tabId}-content .summary-header .summary-meta h1`);
    if (headerH1) headerH1.textContent = newTitle;
  }
}

// 파일시스템에서 해당 파일 제거(있으면)
function removeFromFileSystem(summary) {
  const folders = fileSystem['/'].children;
  Object.values(folders).forEach(folder => {
    Object.keys(folder.children).forEach(name => {
      const file = folder.children[name];
      if (file && file.summary && file.summary.id === summary.id) {
        delete folder.children[name];
      }
    });
  });
}

// 사이드바에서 개별 삭제
function deleteSummary(id, e) {
  if (e) e.stopPropagation(); // 항목 클릭 열기 방지

  const idx = findSummaryIndexById(id);
  if (idx === -1) return;

  const summary = sessionHistory[idx];
  if (!confirm(`"${summary.title}" 을(를) 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;

  // 1) 히스토리에서 제거
  sessionHistory.splice(idx, 1);

  // 2) 파일시스템에서 제거
  removeFromFileSystem(summary);

  // 3) 열려있는 탭 닫기
  const tabId = `summary_${summary.id}`;
  if (openTabs.has(tabId)) {
    closeTab(tabId);
  }

  // 4) UI/저장 갱신
  updateSummariesList();
  updateRecentItems();
  saveSessionHistory();

  showNotification('success', '요약이 삭제되었습니다.');
}

// 사이드바에서 이름 바꾸기(제목만)
function renameSummary(id, e) {
  if (e) e.stopPropagation(); // 항목 클릭 열기 방지

  const idx = findSummaryIndexById(id);
  if (idx === -1) return;

  const current = sessionHistory[idx];
  const proposed = prompt('새 이름을 입력하세요.', current.title);
  if (proposed === null) return; // 취소
  const newTitle = proposed.trim();
  if (!newTitle) {
    showNotification('error', '이름은 비워둘 수 없습니다.');
    return;
  }

  // 1) 히스토리 수정
  current.title = newTitle;

  // 2) 파일시스템의 summary 참조도 같은 객체를 바라보므로 따로 수정할 필요는 없음
  // (파일명은 그대로 두고 제목만 변경)

  // 3) 열려있는 탭 제목 갱신
  updateOpenTabTitle(id, newTitle);

  // 4) UI/저장 갱신
  updateSummariesList();
  updateRecentItems();
  saveSessionHistory();

  showNotification('success', '이름이 변경되었습니다.');
}

// 모든 요약 삭제
function clearAllSummaries() {
    if (confirm('모든 요약 기록을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
        sessionHistory = [];
        
        // 파일 시스템 초기화
        fileSystem['/'].children.recordings.children = {};
        fileSystem['/'].children.summaries.children = {};
        
        // 열려있는 요약 탭들 닫기
        const summaryTabs = Array.from(openTabs.keys()).filter(id => id.startsWith('summary_'));
        summaryTabs.forEach(tabId => closeTab(tabId));
        
        // UI 업데이트
        if (document.getElementById('recordingsFolder') || document.getElementById('summariesFolder')) {
            updateFileTree();
        }
        updateSummariesList();
        updateRecentItems();
        saveSessionHistory();
        
        showNotification('success', '모든 요약 기록이 삭제되었습니다.');
    }
}

// 요약본 클립보드 복사
async function copyResultText(tabId) {
    const box = document.getElementById(`output-${tabId}`);
    if (!box) return;

    // 컨텐츠 영역만 선택 (버튼/메타 제외)
    const content = box.querySelector('.content-body');
    const text = (content ? content.innerText : box.innerText);
    try {
        await navigator.clipboard.writeText(text);
        showNotification('success', '텍스트가 클립보드에 복사되었습니다.');
        flashCopyBtn(tabId); // 선택: 버튼에 잠깐 "복사됨" 표시
    } catch (e) {
        // 폴백: 임시 textarea
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.top = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            showNotification('success', '텍스트가 클립보드에 복사되었습니다.');
            flashCopyBtn(tabId);
        } catch {
            showNotification('error', '복사에 실패했습니다.');
        } finally {
            document.body.removeChild(ta);
        }
    }
}

// 복사 성공 메세지 출력
function flashCopyBtn(tabId) {
    let btn = document.querySelector(`#${tabId}-content .copy-row .btn.copy-btn`);
    if (!btn) btn = document.querySelector(`#${tabId}-content .result .result-row .btn.ghost`);
    if (!btn) return;
    const icon = btn.querySelector('i');
    const span = btn.querySelector('span');
    const old = span.textContent;
    span.textContent = '복사됨';
    icon.classList.remove('fa-copy');
    icon.classList.add('fa-check');
    setTimeout(() => {
        span.textContent = old;
        icon.classList.remove('fa-check');
        icon.classList.add('fa-copy');
    }, 1200);
}

// 버튼 상태 관리
function enableSummarizeButton() {
    const summarizeBtn = document.getElementById('summarizeBtn');
    summarizeBtn.disabled = false;
}

function disableSummarizeButton() {
    const summarizeBtn = document.getElementById('summarizeBtn');
    summarizeBtn.disabled = true;
}

// 알림 표시
function showNotification(type, message) {
    // 간단한 알림 (실제 구현시 토스트 알림으로 개선)
    const alertType = type === 'error' ? '오류' : '알림';
    console.log(`[${alertType}] ${message}`);
    
    // 브라우저 알림으로 임시 구현
    if (type === 'error') {
        alert(`❌ ${message}`);
    } else {
        console.log(`✅ ${message}`);
    }
}

// 로딩 오버레이 제어
function showLoading(show) {
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (show) {
        loadingOverlay.classList.add('active');
    } else {
        loadingOverlay.classList.remove('active');
    }
}

// 세션 히스토리 저장/불러오기
function saveSessionHistory() {
    try {
        localStorage.setItem('vscode_lectureAI_history', JSON.stringify(sessionHistory));
    } catch (error) {
        console.error('히스토리 저장 실패:', error);
    }
}

function loadSessionHistory() {
    try {
        const saved = localStorage.getItem('vscode_lectureAI_history');
        if (saved) {
            sessionHistory = JSON.parse(saved);
            
            // 파일 시스템 복원
            sessionHistory.forEach(summary => {
                addToFileSystem(summary);
            });
            
            if (document.getElementById('recordingsFolder') || document.getElementById('summariesFolder')) {
                updateFileTree();
            }
            updateSummariesList();
            updateRecentItems();
        }
    } catch (error) {
        console.error('히스토리 불러오기 실패:', error);
        sessionHistory = [];
    }
}

// 정리 작업
window.addEventListener('beforeunload', function() {
    if (isRecording && mediaRecorder) {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }
});

// 에러 처리
window.addEventListener('error', function(e) {
    console.error('JavaScript 에러 발생:', e.error);
    showNotification('error', '예상치 못한 오류가 발생했습니다.');
});

console.log('VS Code 스타일 강의 요약 AI 스크립트가 로드되었습니다.');





// ==== 전역 API 설정 ====
const API_CONFIG = {
  baseURL: '/api',
  endpoints: {
    transcribe: '/transcribe'
  },
  // 필요 시 인증 토큰 등 추가
  defaultHeaders: {
    // 'Authorization': 'Bearer <YOUR_TOKEN>'
  },
  timeoutMs: 120_000
};

// 체크박스 상태 읽기
function getKoreanOnlyFlag() {
  const el = document.getElementById('flagKoreanOnly');
  return !!(el && el.checked);
}

// 현재 오디오 파일명/타입 보정
function normalizeAudioFile(file) {
  // File이면 그대로, Blob이면 파일명/타입 보정
  if (file instanceof File) return file;
  const fallbackName = `recording_${Date.now()}.webm`;
  const type = file?.type || 'audio/webm';
  return new File([file], fallbackName, { type });
}

/**
* 오디오 파일과 한국어-only 여부를 백엔드로 전송
@param {Object} opts
@param {Blob|File} [opts.file=currentAudioFile] - 보낼 오디오
@param {boolean} [opts.koreanOnly=UI체크값] - 한국어-only 여부
@returns {Promise<any>} - 백엔드 JSON 응답
*/
async function sendTranscriptionRequest(opts = {}) {
    const fileInput = opts.file || currentAudioFile;
    if (!fileInput) throw new Error('오디오 파일이 없습니다.');

    // 파일/플래그 정리
    const file = normalizeAudioFile(fileInput);
    const koreanOnly = (typeof opts.koreanOnly === 'boolean') ? opts.koreanOnly : getKoreanOnlyFlag();

    // FormData 구성
    const fd = new FormData();
    fd.append('file', file, file.name);
    fd.append('korean_only', String(koreanOnly)); // 'true' | 'false'
    // 확장 여지: fd.append('source', currentAudioFile instanceof File ? 'file' : 'recording');

    // fetch + 타임아웃
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), API_CONFIG.timeoutMs);

    const url = `${API_CONFIG.baseURL}${API_CONFIG.endpoints.transcribe}`;
    let res;
    try {
        res = await fetch(url, {
            method: 'POST',
            body: fd,
            headers: API_CONFIG.defaultHeaders, // FormData일 때 Content-Type 자동 설정됨
            signal: ctrl.signal,
            credentials: 'include' // 쿠키 기반 세션 쓰면 유지, 아니면 지워도 됨
            });
        } finally {
        clearTimeout(to);
    }

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`전송 실패 ${res.status}: ${text || '서버 오류'}`);
    }
    return res.json().catch(() => ({}));
}