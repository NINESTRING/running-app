import { useState } from 'react';
import { ActivityIndicator, Platform } from 'react-native';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { linkGoogleAccount, signInWithGoogle, signOut } from '@/services/auth';
import { useAuthStore } from '@/stores/authStore';

export function AccountSection() {
  const isAnonymous = useAuthStore((s) => s.isAnonymous);
  const email = useAuthStore((s) => s.email);
  const [busy, setBusy] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  // iOS 우선 — 웹은 OAuth 리다이렉트 처리가 달라 이번 범위에서 제외
  if (Platform.OS === 'web') return null;

  const handleLink = async () => {
    setBusy(true);
    setErrorText(null);
    const result = await linkGoogleAccount();
    setBusy(false);
    if (result.status === 'conflict') setConflictOpen(true);
    else if (result.status === 'error') setErrorText(result.error);
    // 'cancelled'는 아무 것도 표시하지 않음
  };

  const handleConflictSignIn = async () => {
    setConflictOpen(false);
    setBusy(true);
    setErrorText(null);
    const result = await signInWithGoogle();
    setBusy(false);
    if (result.status === 'error') setErrorText(result.error);
  };

  const handleSignOut = async () => {
    setBusy(true);
    setErrorText(null);
    const result = await signOut();
    setBusy(false);
    if (!result.ok && result.error) setErrorText(result.error);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>계정</CardTitle>
        <CardDescription>
          {isAnonymous
            ? '게스트로 사용 중 — 구글 계정을 연결하면 기기를 바꾸거나 앱을 다시 설치해도 기록이 유지돼요.'
            : `${email ?? '구글 계정'}으로 연결됨`}
        </CardDescription>
      </CardHeader>
      <CardContent className="gap-3">
        {isAnonymous ? (
          <Button onPress={handleLink} disabled={busy}>
            {busy ? <ActivityIndicator size="small" /> : <Text>구글로 계정 연결</Text>}
          </Button>
        ) : (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={busy}>
                {busy ? <ActivityIndicator size="small" /> : <Text>로그아웃</Text>}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>로그아웃할까요?</AlertDialogTitle>
                <AlertDialogDescription>
                  로그아웃하면 이 기기는 새 게스트 계정으로 시작해요. 구글로 다시
                  로그인하면 기록을 되찾을 수 있어요.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>
                  <Text>취소</Text>
                </AlertDialogCancel>
                <AlertDialogAction onPress={handleSignOut}>
                  <Text>로그아웃</Text>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {errorText ? (
          <Text className="text-sm text-destructive">{errorText}</Text>
        ) : null}

        <AlertDialog open={conflictOpen} onOpenChange={setConflictOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>이미 사용 중인 구글 계정이에요</AlertDialogTitle>
              <AlertDialogDescription>
                이 구글 계정은 다른 계정에 이미 연결되어 있어요. 기존 계정으로
                로그인할까요? 이 기기의 게스트 기록은 옮겨지지 않아요.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                <Text>취소</Text>
              </AlertDialogCancel>
              <AlertDialogAction onPress={handleConflictSignIn}>
                <Text>기존 계정으로 로그인</Text>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
