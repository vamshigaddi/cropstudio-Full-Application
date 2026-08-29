from datetime import datetime, timezone, timedelta
from app.core.logging import get_logger
from app.modules.auth.schemas import CurrentUser
from app.modules.users.models import User
from app.modules.users.repository import UserRepository
from app.modules.users.schemas import UpdateProfileRequest

logger = get_logger(__name__)


class UserService:
    """Business logic for user management."""

    def __init__(self, repository: UserRepository) -> None:
        self._repo = repository

    async def get_or_create_user(self, current_user: CurrentUser) -> User:
        """Get existing user or create a new one on first login.

        This is called on every authenticated request to /users/me.
        On the very first call for a new Supabase user, it creates the
        User + Profile records automatically.
        """
        user = await self._repo.get_by_supabase_id(current_user.id)

        if user is None:
            logger.info(
                "creating_new_user",
                supabase_id=current_user.id,
                email=current_user.email,
            )
            user = await self._repo.create_user(
                supabase_id=current_user.id,
                email=current_user.email,
                role=current_user.role,
            )

        # Check for subscription cycle expiration (Passive Rollover)
        if user and user.profile and user.profile.subscription_period_end:
            now_utc = datetime.now(timezone.utc)
            if user.profile.subscription_period_end <= now_utc:
                logger.info(
                    "subscription_cycle_expired",
                    user_id=str(user.id),
                    current_tier=user.profile.subscription_tier,
                    pending_downgrade=user.profile.pending_downgrade_tier
                )
                
                # Check for scheduled downgrade
                if user.profile.pending_downgrade_tier:
                    tier = user.profile.pending_downgrade_tier
                    user.profile.subscription_tier = tier
                    user.profile.pending_downgrade_tier = None
                    
                    # Apply downgraded quota and credit limits
                    plan_map = {
                        "creator_lite": (300, 30),
                        "brand_pro": (1000, 100),
                        "enterprise_studio": (3000, 300)
                    }
                    if tier in plan_map:
                        credits, quota = plan_map[tier]
                        user.profile.credit_balance = credits
                        user.profile.monthly_image_quota = quota
                    else:
                        user.profile.credit_balance = 10
                        user.profile.monthly_image_quota = 50
                else:
                    # Auto-renew/reset monthly image usage for current active plan
                    # Reset credits to original plan amount (or add difference)
                    plan_map = {
                        "creator_lite": (300, 30),
                        "brand_pro": (1000, 100),
                        "enterprise_studio": (3000, 300)
                    }
                    if user.profile.subscription_tier in plan_map:
                        credits, quota = plan_map[user.profile.subscription_tier]
                        # Reset credits/quota to full tier value upon cycle renewal
                        user.profile.credit_balance = credits
                        user.profile.monthly_image_quota = quota
                    else:
                        user.profile.credit_balance = 10
                        user.profile.monthly_image_quota = 50
                
                # Reset usage counters
                user.profile.images_used_this_month = 0
                
                # Update billing period dates to new cycle
                user.profile.subscription_period_start = user.profile.subscription_period_end
                user.profile.subscription_period_end = user.profile.subscription_period_start + timedelta(days=30)
                
                # Flush changes to DB
                await self._repo._session.flush()

        return user


    async def update_profile(
        self,
        current_user: CurrentUser,
        update_data: UpdateProfileRequest,
    ) -> User:
        """Update the current user's profile."""
        user = await self.get_or_create_user(current_user)

        await self._repo.update_profile(
            user=user,
            display_name=update_data.display_name,
            avatar_url=update_data.avatar_url,
            preferences=update_data.preferences,
        )

        # Re-fetch to get updated profile
        updated_user = await self._repo.get_by_supabase_id(current_user.id)
        if updated_user is None:
            # Should never happen, but satisfy type checker
            return user
        return updated_user

    async def promote_to_admin(self, email: str) -> User:
        """Promote a user to admin by email."""
        from app.core.exceptions import NotFoundError
        user = await self._repo.get_by_email(email)
        if user is None:
            raise NotFoundError(resource="User", identifier=email)
        user.role = "admin"
        await self._repo._session.commit()
        return user

    async def list_users_admin(
        self,
        limit: int = 50,
        offset: int = 0,
        email_search: str | None = None,
    ) -> list[User]:
        """List users for admin management."""
        return await self._repo.list_users(limit=limit, offset=offset, email_search=email_search)

    async def list_users_admin_with_count(
        self,
        limit: int = 50,
        offset: int = 0,
        email_search: str | None = None,
    ) -> tuple[list[User], int]:
        """List users and get total count matching search filter."""
        users = await self._repo.list_users(limit=limit, offset=offset, email_search=email_search)
        total = await self._repo.count_users(email_search=email_search)
        return users, total

    async def get_admin_stats(self) -> dict:
        """Get summary stats for admin dashboard."""
        return await self._repo.get_admin_stats()

    async def adjust_user_credits(self, user_id: str, amount: int) -> User:
        """Adjust a user's credit balance."""
        from app.core.exceptions import NotFoundError
        user = await self._repo.get_by_id(user_id)
        if user is None:
            raise NotFoundError(resource="User", identifier=user_id)
        if user.profile is None:
            from app.modules.users.models import Profile
            user.profile = Profile(user_id=user.id)
            self._repo._session.add(user.profile)
            
        user.profile.credit_balance = max(0, user.profile.credit_balance + amount)
        await self._repo._session.commit()
        return user

    async def change_user_tier(self, user_id: str, tier: str) -> User:
        """Manually change a user's subscription tier and reset quotas."""
        from app.core.exceptions import NotFoundError, ValidationError
        valid_tiers = {"free", "creator_lite", "brand_pro", "enterprise_studio"}
        if tier not in valid_tiers:
            raise ValidationError(f"Invalid subscription tier: {tier}")
            
        user = await self._repo.get_by_id(user_id)
        if user is None:
            raise NotFoundError(resource="User", identifier=user_id)
        if user.profile is None:
            from app.modules.users.models import Profile
            user.profile = Profile(user_id=user.id)
            self._repo._session.add(user.profile)

        user.profile.subscription_tier = tier
        
        # Apply standard quota and credit limits
        plan_map = {
            "creator_lite": (200, 200),
            "brand_pro": (1000, 1000),
            "enterprise_studio": (4000, 4000),
            "free": (10, 50)
        }
        credits, quota = plan_map[tier]
        user.profile.credit_balance = credits
        user.profile.monthly_image_quota = quota
        user.profile.images_used_this_month = 0
        user.profile.pending_downgrade_tier = None
        
        # Set subscription period
        now = datetime.now(timezone.utc)
        user.profile.subscription_period_start = now
        user.profile.subscription_period_end = now + timedelta(days=30)
        
        await self._repo._session.commit()
        return user
