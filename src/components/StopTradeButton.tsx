import { Square } from 'lucide-react'
import { Button, type ButtonProps } from './ui/Button'

type StopTradeButtonProps = {
  onClick?: () => void
  disabled?: boolean
  size?: ButtonProps['size']
}

export function StopTradeButton({ onClick, disabled, size = 'sm' }: StopTradeButtonProps) {
  return (
    <Button
      variant="danger"
      size={size}
      leftIcon={<Square className="h-3 w-3" />}
      onClick={onClick}
      disabled={disabled}
    >
      Stop
    </Button>
  )
}
