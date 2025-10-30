"""
설치/선택(프로비저닝) 전용 모듈.
- 실행 전 모델을 준비하고 ai.config.json을 생성/갱신.
"""

from . import probe, resolve, install, manager

__all__ = ["probe", "resolve", "install", "manager"]