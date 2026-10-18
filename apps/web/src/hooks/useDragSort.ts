/**
 * 拖拽排序（HTML5 原生 DnD，零依赖）
 *
 * 管理员在**前台页面**直接拖三种东西：
 *   ① 作品 / 文稿在文件夹内排序，或拖到另一个文件夹里（itemProps）
 *   ② 文件夹长条本身改位置，拖到别的长条上/下半区决定插前插后（folderProps）
 * 访客（enabled = false）拿到的 props 是 draggable:false，改不了任何东西。
 *
 * 用法：
 *   const { itemProps, folderProps, isDragging } = useDragSort(Boolean(admin), {
 *     onItemDrop: (drag, target) => {...},
 *     onFolderDrop: (dragId, overId, after) => {...},   // 不给这个回调 = 文件夹不可拖
 *   });
 *   <li {...itemProps({ id, folderId })}>…</li>
 *   <section {...folderProps(folderId)}>…</section>
 */
import { useCallback, useRef, useState, type DragEvent } from 'react';

export interface ItemDrag {
  id: string;
  /** 当前所属文件夹；null = 未归档 */
  folderId: string | null;
}

export interface DropTarget {
  /** 拖到哪个文件夹（null = 未归档区） */
  folderId: string | null;
  /** 插到这一条之前；null = 放到该文件夹末尾 */
  beforeId: string | null;
}

export interface DragSortHandlers {
  onItemDrop: (drag: ItemDrag, target: DropTarget) => void;
  /**
   * 拖文件夹本身。overId = 目标文件夹（null = 「未归档」区，意为放到最后），
   * after = 插在它的后面（按指针在长条上/下半区判断）。
   */
  onFolderDrop?: (dragId: string, overId: string | null, after: boolean) => void;
}

/** 正在被拖的东西：一条作品/文稿，或一个文件夹长条 */
type Payload = { kind: 'item'; item: ItemDrag } | { kind: 'folder'; id: string };

/** 高亮用的 key：文件夹或某一条 */
const folderKey = (id: string | null) => `folder:${id ?? '__none__'}`;
const itemKey = (id: string) => `item:${id}`;

export function useDragSort(enabled: boolean, handlers: DragSortHandlers) {
  const [drag, setDrag] = useState<Payload | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  // 权威来源用 ref：如果只靠 state，拖得很快时 drop 的闭包里可能还是 null
  const dragRef = useRef<Payload | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const finish = useCallback(() => {
    dragRef.current = null;
    setDrag(null);
    setOverKey(null);
  }, []);

  /** 挂到每一条可拖拽元素上 */
  const itemProps = useCallback(
    (item: ItemDrag) => {
      if (!enabled) return { draggable: false as const };
      return {
        draggable: true,
        onDragStart: (e: DragEvent<HTMLElement>) => {
          // 外面那圈长条也是可拖的（拖文件夹），不拦住的话会把 payload 覆盖掉
          e.stopPropagation();
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', item.id);
          dragRef.current = { kind: 'item', item };
          setDrag({ kind: 'item', item });
        },
        onDragEnd: finish,
        onDragOver: (e: DragEvent<HTMLElement>) => {
          const payload = dragRef.current;
          if (!payload) return;
          // 正在拖文件夹：不吃这个事件，让它冒泡给长条去算插前插后
          if (payload.kind === 'folder') return;
          e.preventDefault();
          e.stopPropagation();
          setOverKey(itemKey(item.id));
        },
        onDrop: (e: DragEvent<HTMLElement>) => {
          const payload = dragRef.current;
          if (!payload) return;
          if (payload.kind === 'folder') return; // 同上：交给长条
          e.preventDefault();
          e.stopPropagation();
          handlersRef.current.onItemDrop(payload.item, { folderId: item.folderId, beforeId: item.id });
          finish();
        },
        'data-over': overKey === itemKey(item.id) ? 'true' : undefined,
        'data-dragging': drag?.kind === 'item' && drag.item.id === item.id ? 'true' : undefined,
      };
    },
    [enabled, drag, overKey, finish],
  );

  /**
   * 挂到文件夹长条上：
   *   - 作为**落点**：拖作品进来 = 放进这个文件夹的末尾；拖文件夹进来 = 插到它前/后；
   *   - 作为**拖源**：整条可抓（只有给了 onFolderDrop 才可拖；「未归档」不是真文件夹，不给拖）。
   */
  const folderProps = useCallback(
    (folderId: string | null) => {
      if (!enabled) return {};
      const key = folderKey(folderId);
      const canDrag = folderId !== null && Boolean(handlersRef.current.onFolderDrop);

      /** 指针落在长条的上半还是下半：决定插到目标前面还是后面 */
      const isAfter = (e: DragEvent<HTMLElement>) => {
        if (folderId === null) return true; // 未归档区 = 放到文件夹列表最后
        const rect = e.currentTarget.getBoundingClientRect();
        return e.clientY > rect.top + rect.height / 2;
      };

      const markOver = (e: DragEvent<HTMLElement>, payload: Payload) => {
        if (payload.kind === 'folder') {
          if (payload.id === folderId) return; // 拖到自己身上：不显示任何落点
          setOverKey(`${key}:${isAfter(e) ? 'after' : 'before'}`);
        } else {
          setOverKey(key);
        }
      };

      const dropHere = (payload: Payload, after: boolean) => {
        if (payload.kind === 'folder') {
          if (payload.id === folderId) return;
          handlersRef.current.onFolderDrop?.(payload.id, folderId, after);
        } else {
          handlersRef.current.onItemDrop(payload.item, { folderId, beforeId: null });
        }
      };

      const overSuffix = overKey === `${key}:before` ? 'before' : overKey === `${key}:after` ? 'after' : null;

      return {
        ...(canDrag
          ? {
              draggable: true,
              onDragStart: (e: DragEvent<HTMLElement>) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', folderId);
                dragRef.current = { kind: 'folder', id: folderId };
                setDrag({ kind: 'folder', id: folderId });
              },
              onDragEnd: finish,
            }
          : {}),
        onDragOver: (e: DragEvent<HTMLElement>) => {
          const payload = dragRef.current;
          if (!payload) return;
          e.preventDefault();
          markOver(e, payload);
        },
        onDrop: (e: DragEvent<HTMLElement>) => {
          const payload = dragRef.current;
          if (!payload) return;
          e.preventDefault();
          dropHere(payload, isAfter(e));
          finish();
        },
        'data-drop-target':
          drag?.kind === 'item' && overKey === key && drag.item.folderId !== folderId ? 'true' : undefined,
        'data-folder-over':
          drag?.kind === 'folder' && drag.id !== folderId && overSuffix ? overSuffix : undefined,
        'data-dragging': drag?.kind === 'folder' && drag.id === folderId ? 'true' : undefined,
      };
    },
    [enabled, drag, overKey, finish],
  );

  return { drag, itemProps, folderProps, isDragging: Boolean(drag), draggingKind: drag?.kind ?? null };
}

/**
 * 根据「拖了谁、丢在哪」算出新的平铺顺序（页面直接拿它去提交）。
 * 只改顺序与归属，不改其它字段。
 */
export function reorderList<T extends { id: string; folderId: string | null }>(
  items: T[],
  drag: ItemDrag,
  target: DropTarget,
): T[] {
  const moved = items.find((i) => i.id === drag.id);
  if (!moved) return items;

  const rest = items.filter((i) => i.id !== drag.id);
  const next = { ...moved, folderId: target.folderId } as T;

  if (target.beforeId) {
    const idx = rest.findIndex((i) => i.id === target.beforeId);
    if (idx >= 0) {
      rest.splice(idx, 0, next);
      return rest;
    }
  }

  // 丢在文件夹空白处：放到该文件夹最后一个成员之后
  let lastIdx = -1;
  rest.forEach((it, i) => {
    if (it.folderId === target.folderId) lastIdx = i;
  });
  if (lastIdx === -1) return [...rest, next];
  rest.splice(lastIdx + 1, 0, next);
  return rest;
}

/**
 * 文件夹重排：把 dragId 这条挪到 overId 的前面或后面（overId = null 意为放到最后）。
 * 顺序没变就返回 null —— 调用方据此跳过这次提交。
 */
export function moveFolder<T extends { id: string }>(
  list: T[],
  dragId: string,
  overId: string | null,
  after: boolean,
): T[] | null {
  const moved = list.find((f) => f.id === dragId);
  if (!moved) return null;

  const rest = list.filter((f) => f.id !== dragId);
  let at = rest.length;
  if (overId) {
    const idx = rest.findIndex((f) => f.id === overId);
    if (idx < 0) return null;
    at = after ? idx + 1 : idx;
  }

  const next = [...rest];
  next.splice(at, 0, moved);
  return next.every((f, i) => f.id === list[i].id) ? null : next;
}
