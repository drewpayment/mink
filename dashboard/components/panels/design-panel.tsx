"use client";

import { useState } from "react";
import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useFormat } from "@/hooks/use-format";
import { Image, X } from "lucide-react";
import type { DesignImagePayload } from "@mink/types/dashboard";

export function DesignPanel() {
  const designImages = useDashboardStore((s) => s.designImages);
  const connected = useDashboardStore((s) => s.connected);
  const { formatDateTime } = useFormat();
  const [selectedImage, setSelectedImage] = useState<DesignImagePayload | null>(null);

  if (!connected && designImages.length === 0) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      </div>
    );
  }

  if (designImages.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center">
            <Image className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              No design captures yet. Run: mink designqc
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Image className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          {designImages.length} captures
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {designImages.map((img, i) => (
          <Card
            key={i}
            className="cursor-pointer overflow-hidden transition-shadow hover:shadow-lg"
            onClick={() => setSelectedImage(img)}
          >
            <div className="aspect-video bg-muted relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt={`${img.route} - ${img.viewport}`}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </div>
            <CardContent className="py-2 px-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono truncate">{img.route}</span>
                <Badge variant="outline" className="text-[10px]">
                  {img.viewport}
                </Badge>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {formatDateTime(img.timestamp)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Lightbox Dialog */}
      <Dialog
        open={selectedImage !== null}
        onOpenChange={(open) => !open && setSelectedImage(null)}
      >
        <DialogContent className="max-w-4xl">
          <DialogTitle className="sr-only">Design Capture</DialogTitle>
          {selectedImage && (
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selectedImage.url}
                alt={`${selectedImage.route} - ${selectedImage.viewport}`}
                className="w-full rounded-md"
              />
              <div className="flex items-center justify-between mt-3">
                <div>
                  <span className="text-sm font-mono">{selectedImage.route}</span>
                  <Badge variant="outline" className="ml-2 text-[10px]">
                    {selectedImage.viewport}
                  </Badge>
                  <Badge variant="secondary" className="ml-1 text-[10px]">
                    Section {selectedImage.section}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(selectedImage.timestamp)}
                </span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
