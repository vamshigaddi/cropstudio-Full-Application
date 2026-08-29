"""Users module — Repository for database access.

All database queries for the users module live here.
Services call repositories; repositories never contain business logic.
"""

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.modules.users.models import Profile, User


class UserRepository:
    """Database access layer for User and Profile entities."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_supabase_id(self, supabase_id: str) -> User | None:
        """Find a user by their Supabase Auth ID, eagerly loading the profile."""
        stmt = select(User).options(joinedload(User.profile)).where(User.supabase_id == supabase_id)
        result = await self._session.execute(stmt)
        return result.unique().scalar_one_or_none()

    async def create_user(
        self,
        supabase_id: str,
        email: str | None = None,
        role: str = "user",
    ) -> User:
        """Create a new user with a default profile."""
        user = User(
            supabase_id=supabase_id,
            email=email,
            role=role,
        )
        self._session.add(user)
        await self._session.flush()  # Generate user.id before creating profile

        profile = Profile(
            user_id=user.id,
            subscription_tier="free",
            monthly_image_quota=50,
            images_used_this_month=0,
            max_batch_size=10,
            credit_balance=10,
        )
        self._session.add(profile)
        await self._session.flush()

        # Reload with relationship
        user.profile = profile
        return user

    async def update_profile(
        self,
        user: User,
        display_name: str | None = None,
        avatar_url: str | None = None,
        preferences: dict[str, object] | None = None,
    ) -> Profile:
        """Update a user's profile fields. Only updates non-None values."""
        profile = user.profile
        if profile is None:
            # Edge case: create profile if it doesn't exist
            profile = Profile(user_id=user.id)
            self._session.add(profile)

        if display_name is not None:
            profile.display_name = display_name
        if avatar_url is not None:
            profile.avatar_url = avatar_url
        if preferences is not None:
            profile.preferences = preferences

        await self._session.flush()
        return profile

    async def get_by_email(self, email: str) -> User | None:
        """Find a user by their email, eagerly loading the profile."""
        stmt = select(User).options(joinedload(User.profile)).where(User.email == email)
        result = await self._session.execute(stmt)
        return result.unique().scalar_one_or_none()

    async def get_by_id(self, user_id: str) -> User | None:
        """Find a user by their internal UUID, eagerly loading the profile."""
        import uuid
        if isinstance(user_id, str):
            try:
                uid_obj = uuid.UUID(user_id)
            except ValueError:
                return None
        else:
            uid_obj = user_id
        stmt = select(User).options(joinedload(User.profile)).where(User.id == uid_obj)
        result = await self._session.execute(stmt)
        return result.unique().scalar_one_or_none()

    async def list_users(
        self,
        limit: int = 50,
        offset: int = 0,
        email_search: str | None = None,
    ) -> list[User]:
        """List all users with search and pagination, eagerly loading profiles."""
        stmt = select(User).options(joinedload(User.profile))
        if email_search:
            stmt = stmt.where(User.email.ilike(f"%{email_search}%"))
        stmt = stmt.order_by(User.created_at.desc()).limit(limit).offset(offset)
        result = await self._session.execute(stmt)
        return list(result.unique().scalars().all())

    async def count_users(self, email_search: str | None = None) -> int:
        """Count users matching the search filter."""
        stmt = select(func.count()).select_from(User)
        if email_search:
            stmt = stmt.where(User.email.ilike(f"%{email_search}%"))
        result = await self._session.execute(stmt)
        return result.scalar() or 0

    async def get_admin_stats(self) -> dict:
        """Get summary statistics for the admin dashboard."""
        from app.modules.users.models import Profile
        
        # 1. Total Users
        total_stmt = select(func.count()).select_from(User)
        total_res = await self._session.execute(total_stmt)
        total_users = total_res.scalar() or 0
        
        # 2. Active Pro Plans (tier in creator_lite, brand_pro, enterprise_studio)
        pro_stmt = select(func.count()).select_from(Profile).where(
            Profile.subscription_tier.in_(["creator_lite", "brand_pro", "enterprise_studio"])
        )
        pro_res = await self._session.execute(pro_stmt)
        active_pro_plans = pro_res.scalar() or 0
        
        # 3. Average Credits
        avg_stmt = select(func.avg(Profile.credit_balance)).select_from(Profile)
        avg_res = await self._session.execute(avg_stmt)
        avg_val = avg_res.scalar()
        avg_credits = float(avg_val) if avg_val is not None else 0.0
        
        # 4. Enterprise Plans
        ent_stmt = select(func.count()).select_from(Profile).where(
            Profile.subscription_tier == "enterprise_studio"
        )
        ent_res = await self._session.execute(ent_stmt)
        enterprise_plans = ent_res.scalar() or 0
        
        return {
            "total_users": total_users,
            "active_pro_plans": active_pro_plans,
            "enterprise_plans": enterprise_plans,
            "avg_credits": avg_credits
        }
