import { MapPinOff } from 'lucide-react';
import { LinkButton } from '../components/ui/Button';
import { EmptyState } from '../components/ui/Feedback';
import { useDocumentTitle } from '../lib/hooks';

export default function NotFound() {
  useDocumentTitle('Page not found');
  return (
    <EmptyState icon={<MapPinOff className="size-5" />} title="This page doesn't exist" action={<LinkButton to="/">Go to overview</LinkButton>}>
      The link may be old or mistyped.
    </EmptyState>
  );
}
