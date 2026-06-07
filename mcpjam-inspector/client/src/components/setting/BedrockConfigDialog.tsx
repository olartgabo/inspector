import { ExternalLink } from "lucide-react";
import { Button } from "@mcpjam/design-system/button";
import { Input } from "@mcpjam/design-system/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@mcpjam/design-system/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mcpjam/design-system/select";

// AgentCore-supported regions (mirrors lessons/05-aws-setup-guide.md). These
// are the regions where Bedrock + AgentCore are generally available; the model
// inference-profile IDs in SUPPORTED_MODELS use the `us.` cross-region prefix,
// so us-east-1 / us-west-2 are the safe defaults for the Claude models we list.
const BEDROCK_REGIONS = [
  "us-east-1",
  "us-west-2",
  "eu-west-1",
  "ap-southeast-1",
  "ap-northeast-1",
] as const;

interface BedrockConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  region: string;
  apiKey: string;
  onRegionChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onRemove?: () => void;
}

export function BedrockConfigDialog({
  open,
  onOpenChange,
  region,
  apiKey,
  onRegionChange,
  onApiKeyChange,
  onSave,
  onCancel,
  onRemove,
}: BedrockConfigDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-lg bg-card p-2 flex items-center justify-center border">
              <img
                src="/aws_bedrock_logo.svg"
                alt="AWS Bedrock Logo"
                className="w-full h-full object-contain"
              />
            </div>
            <div>
              <DialogTitle className="text-left pb-2">
                Configure AWS Bedrock
              </DialogTitle>
              <DialogDescription className="text-left">
                Run Claude models via Amazon Bedrock with a Bedrock API key
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label htmlFor="bedrock-region" className="text-sm font-medium">
              AWS Region
            </label>
            <Select value={region} onValueChange={onRegionChange}>
              <SelectTrigger id="bedrock-region" className="mt-1">
                <SelectValue placeholder="Select a region" />
              </SelectTrigger>
              <SelectContent>
                {BEDROCK_REGIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label htmlFor="bedrock-api-key" className="text-sm font-medium">
              Bedrock API Key
            </label>
            <Input
              id="bedrock-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              placeholder="Bedrock API key (Bearer token)"
              className="mt-1"
            />
          </div>

          <div className="flex items-center gap-2 p-3 bg-info/10 rounded-lg">
            <ExternalLink className="w-4 h-4 text-info" />
            <span className="text-sm text-info">
              Need a key?{" "}
              <button
                onClick={() =>
                  window.open(
                    "https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html",
                    "_blank",
                  )
                }
                className="underline hover:no-underline"
              >
                Generate a Bedrock API key
              </button>
            </span>
          </div>
        </div>

        <DialogFooter>
          {onRemove ? (
            <Button variant="outline" onClick={onRemove} className="mr-auto">
              Remove
            </Button>
          ) : null}
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={!apiKey.trim() || !region.trim()}>
            Save Configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
