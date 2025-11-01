<img src="https://github.com/user-attachments/assets/adfa14ec-a191-494a-8292-6e1ba4848295" alt="TeamLogo" width="512" height="512" />

#  Local Audio Intelligence
> **로컬 환경에서 개인정보 유출 없이, 긴 오디오를 자동으로 화자 구분·전사·요약하는 AI 음성 처리 솔루션**

##  프로젝트 개요

회의·인터뷰·강의 등 **음성 기반 정보**의 비중이 커지고 있지만, 여전히 이를 **정리·검색·공유 가능한 데이터**로 전환하는 과정은 수작업에 의존합니다.  
본 프로젝트는 **인터넷 연결이나 계정 로그인 없이**, **100% 로컬 환경에서 안전하게** 음성 데이터를 처리할 수 있는 자동화 솔루션을 제공합니다.

##  핵심 문제 정의

> “로컬 환경에서 개인정보 유출 없이, 긴 오디오를 자동으로 **화자 구분 + 전사 + 요약**할 수 있는 효율적인 솔루션이 없다.”

---

##  목표

###  정량적 목표
- **3시간 이상 오디오** 로컬 처리 가능  
- Whisper large-v3 기준 **STT 정확도 ≥ 90%**  
- pyannote 기반 **화자 분리 정확도 ≥ 85%**  
- **GPU 미보유 환경**에서도 **10분 내 전사+요약 완료**

###  정성적 목표
- 원클릭으로 회의록/강의록 완성  
- **작업 단계·진행 상황 시각화**  
- 비전문가도 사용 가능한 **로컬 전용 UI**  
- **프라이버시 보호 중심 설계**

---

##  핵심 가치

| 가치 | 설명 |
|------|------|
| **Privacy** | 모든 데이터는 로컬에서 처리 (외부 전송 없음) |
| **Automation** | 분할 → 화자 인식 → 전사 → 요약까지 자동화 |
| **Intelligence** | LLM 기반 요약 및 주요 포인트 추출 |
| **Simplicity** | 설정 없이 직관적인 웹 UI |
| **Efficiency** | 중저사양 PC에서도 실행 가능 |

---

##  주요 기능

| 기능 | 설명 |
|------|------|
| 오디오 업로드 | mp3/wav 등 로컬 파일 업로드 |
| 전처리 | 오디오 정규화, 분할, 잡음 제거 |
| 화자 분리 | pyannote.audio 기반 화자 인식 |
| 음성 인식 | Whisper large-v3 기반 고정밀 전사 |
| 발화 병합 | 화자별 대화 병합 및 정렬 |
| 요약·키워드 | LLM 기반 요약 및 핵심 키워드 추출 |
| 시각화 | 타임라인별 화자·대화 로그 뷰어 |
| 데이터 관리 | PostgreSQL 기반 프로젝트 관리 및 검색 |
| 로컬 웹 UI | HTML/CSS/JS + Electron 기반 UI |

---

##  기술 스택

**Frontend:**  
HTML · CSS · JavaScript · Electron  

**Backend:**  
FastAPI · PostgreSQL  

**AI/ML:**  
PyTorch · Transformers  

**Models:**  
Whisper · pyannote.audio · Qwen3  

---

##  설치 및 실행 방법

### 환경 설정
```bash
git clone https://github.com/your-repo/local-audio-intelligence.git
cd local-audio-intelligence
python -m venv .venv
.venv\Scripts\activate   # (Windows)
pip install -r requirements.txt
