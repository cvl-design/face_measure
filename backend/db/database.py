from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import event, text
from backend.core.config import settings
from backend.core.logging_config import get_logger

logger = get_logger(__name__)


class Base(DeclarativeBase):
    pass


def _make_engine():
    # 确保 data/ 目录存在
    settings.data_dir_path

    db_url = f"sqlite+aiosqlite:///{settings.sqlite_path}"
    engine = create_async_engine(
        db_url,
        echo=False,  # 避免 SQLAlchemy 日志刷屏；SQL 调试改用 LOG_LEVEL=DEBUG
        connect_args={"check_same_thread": False},
    )
    return engine


engine = _make_engine()

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


async def init_db() -> None:
    """建表 + 开启 WAL 模式（FastAPI lifespan 中调用）"""
    async with engine.begin() as conn:
        # 开启 WAL 模式，提升并发读写性能
        await conn.execute(text("PRAGMA journal_mode=WAL"))
        await conn.execute(text("PRAGMA foreign_keys=ON"))
        await conn.run_sync(Base.metadata.create_all)
    logger.info("database initialized", path=settings.sqlite_path, mode="WAL")


async def get_db():
    """FastAPI Depends 注入：提供 AsyncSession"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
