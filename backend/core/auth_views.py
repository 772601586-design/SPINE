import hashlib

from django.contrib.auth import authenticate, get_user_model
from django.db import IntegrityError, transaction
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from core.errors import ErrorCode, SpineError
from core.models import WechatAccount
from core.wechat import WechatError, WechatNotConfigured, exchange_code


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(write_only=True, trim_whitespace=False)


class UserSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    username = serializers.CharField()


class LoginResponseSerializer(serializers.Serializer):
    token = serializers.CharField()
    user = UserSerializer()


class LoginThrottle(AnonRateThrottle):
    rate = "20/min"


class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [LoginThrottle]

    @extend_schema(request=LoginSerializer, responses=LoginResponseSerializer, tags=["Personal account"])
    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = authenticate(**serializer.validated_data)
        if user is None:
            raise SpineError("用户名或密码错误。", ErrorCode.VALIDATION_ERROR, status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            get_user_model().objects.select_for_update().get(pk=user.pk)
            token, _ = Token.objects.get_or_create(user=user)
        return Response({"token": token.key, "user": UserSerializer(user).data})


class LogoutView(APIView):
    @extend_schema(request=None, responses={204: None}, tags=["Personal account"])
    def post(self, request):
        with transaction.atomic():
            get_user_model().objects.select_for_update().get(pk=request.user.pk)
            Token.objects.filter(user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    @extend_schema(responses=UserSerializer, tags=["Personal account"])
    def get(self, request):
        return Response(UserSerializer(request.user).data)


WECHAT_USERNAME_PREFIX = "wx_"


class WechatLoginSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=128, trim_whitespace=False)


class WechatLoginResponseSerializer(serializers.Serializer):
    token = serializers.CharField()
    user = UserSerializer()
    is_new = serializers.BooleanField()


def _username_for_openid(openid):
    """openid 不直接充当用户名。

    openid 是对用户稳定的身份标识，没必要出现在接口返回和界面里，这里只保留
    它的哈希前缀，既能保证同名复用，又不把原始标识散播出去。
    """
    digest = hashlib.sha256(openid.encode("utf-8")).hexdigest()[:16]
    return f"{WECHAT_USERNAME_PREFIX}{digest}"


def _link_wechat_account(openid, unionid):
    """返回 (user, is_new)。同一 openid 重复登录复用同一账号。"""
    account = WechatAccount.objects.select_related("user").filter(openid=openid).first()
    if account is not None:
        WechatAccount.objects.filter(pk=account.pk).update(last_login_at=timezone.now())
        return account.user, False
    try:
        with transaction.atomic():
            user = get_user_model()(username=_username_for_openid(openid))
            # 微信账号没有可用密码，避免它从账号密码入口被登录。
            user.set_unusable_password()
            user.save()
            WechatAccount.objects.create(
                user=user, openid=openid, unionid=unionid, last_login_at=timezone.now()
            )
        return user, True
    except IntegrityError:
        # 同一 openid 并发首登时另一请求已建好账号，复用即可。
        account = WechatAccount.objects.select_related("user").get(openid=openid)
        return account.user, False


class WechatLoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [LoginThrottle]

    @extend_schema(
        request=WechatLoginSerializer,
        responses=WechatLoginResponseSerializer,
        tags=["Personal account"],
    )
    def post(self, request):
        serializer = WechatLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            openid, unionid = exchange_code(serializer.validated_data["code"])
        except WechatNotConfigured:
            raise SpineError(
                "服务端尚未配置微信小程序凭证。",
                ErrorCode.SERVICE_UNAVAILABLE,
                status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except WechatError as error:
            raise SpineError(str(error), ErrorCode.VALIDATION_ERROR, status.HTTP_400_BAD_REQUEST)

        user, is_new = _link_wechat_account(openid, unionid)
        with transaction.atomic():
            get_user_model().objects.select_for_update().get(pk=user.pk)
            token, _ = Token.objects.get_or_create(user=user)
        return Response({
            "token": token.key,
            "user": UserSerializer(user).data,
            "is_new": is_new,
        })
