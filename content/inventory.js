'use strict';
globalThis.SGC = {};
(() => {
  function canTurnIntoGems(item) {
    return Array.isArray(item.owner_actions) &&
      item.owner_actions.some(action => String(action?.link || '').includes('GetGooValue'));
  }

  function extractGooParams(item) {
    if (item.gooParams) return item.gooParams;

    for (const action of item.owner_actions || []) {
      const link = String(action?.link || '');
      if (!link.includes('GetGooValue')) continue;

      const match = link.match(
        /GetGooValue\(\s*['"]%contextid%['"]\s*,\s*['"]%assetid%['"]\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/
      );

      if (match) {
        return {
          appid: Number(match[1]),
          item_type: Number(match[2]),
          border_color: Number(match[3])
        };
      }
    }

    return null;
  }

  function findTag(item, predicate) {
    return (item.tags || []).find(predicate) || null;
  }

  function getTagByCategory(item, categoryName) {
    const target = String(categoryName || '').toLowerCase();

    return findTag(item, tag => {
      const category = String(tag.category || '').toLowerCase();
      const localizedCategory = String(tag.localized_category_name || '').toLowerCase();
      return category === target || localizedCategory === target;
    });
  }

  function getGameNameFromTags(item) {
    const gameTag = findTag(item, tag => {
      const category = String(tag.category || '').toLowerCase();
      const localizedCategory = String(tag.localized_category_name || '').toLowerCase();
      const internal = String(tag.internal_name || '').toLowerCase();
      return category === 'game' || localizedCategory === 'game' || /^app_\d+$/.test(internal);
    });

    return String(gameTag?.localized_tag_name || '').trim();
  }

  function stripGamePrefix(text, gameName) {
    const source = String(text || '').replace(/\s+/g, ' ').trim();
    const game = String(gameName || '').replace(/\s+/g, ' ').trim();
    if (!source || !game) return source;

    const lowerSource = source.toLowerCase();
    const lowerGame = game.toLowerCase();

    if (lowerSource.startsWith(`${lowerGame} `)) {
      return source.slice(game.length).trim();
    }

    return source;
  }

  function inferGameNameFromType(item) {
    const rawType = String(item.type || item.description?.type || '').replace(/\s+/g, ' ').trim();
    if (!rawType) return '';

    const suffixes = [
      'Foil Trading Card',
      'Trading Card',
      'Profile Background',
      'Emoticon',
      'Booster Pack',
      'Steam Gems',
      'Sale Item'
    ];

    for (const suffix of suffixes) {
      if (rawType.toLowerCase().endsWith(` ${suffix.toLowerCase()}`)) {
        const name = rawType.slice(0, rawType.length - suffix.length).trim();
        if (name) return name;
      }
    }

    return '';
  }

  function getAppDisplayName(item) {
    return getGameNameFromTags(item) || inferGameNameFromType(item) || 'Unknown Game';
  }

  function getTypeLabel(item, appName) {
    const rawType = String(item.type || item.description?.type || '').replace(/\s+/g, ' ').trim();
    const rawStripped = stripGamePrefix(rawType, appName);
    const itemClassTag = getTagByCategory(item, 'item_class') || getTagByCategory(item, 'Item Type');
    const cardBorderTag = getTagByCategory(item, 'cardborder') || getTagByCategory(item, 'Card Border');
    const itemClass = String(itemClassTag?.localized_tag_name || '').trim();
    const cardBorder = String(cardBorderTag?.localized_tag_name || '').trim();

    if (rawStripped && /foil/i.test(rawStripped) && itemClass && !/foil/i.test(itemClass)) {
      return rawStripped;
    }

    if (itemClass) {
      if (cardBorder && !/^normal$/i.test(cardBorder) && /trading card/i.test(itemClass)) {
        return `${cardBorder} ${itemClass}`;
      }
      return itemClass;
    }

    if (rawStripped) return rawStripped;

    const params = extractGooParams(item);
    if (params) return `Item Type ${params.item_type}`;

    return 'Unknown Type';
  }

  function getItemDisplayName(item) {
    return String(
      item.market_name ||
      item.name ||
      item.description?.market_name ||
      item.description?.name ||
      item.market_hash_name ||
      `Asset ${item.assetid}`
    ).replace(/\s+/g, ' ').trim();
  }

  function normalizeKey(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function decorateInventoryItem(item) {
    const params = extractGooParams(item);
    const appid = Number(params?.appid || item.market_fee_app || item.description?.market_fee_app || 0);
    const appName = getAppDisplayName(item);
    const typeLabel = getTypeLabel(item, appName);
    const itemName = getItemDisplayName(item);
    const itemKey = `${item.classid || '0'}_${item.instanceid || '0'}`;
    const typeKey = normalizeKey(typeLabel) || `item_type_${params?.item_type || 'unknown'}`;

    return {
      ...item,
      gooParams: params,
      gooAppId: appid || null,
      appName,
      itemName,
      typeLabel,
      itemKey,
      typeKey
    };
  }


  function join(assets, descriptions) {
    const map = new Map(descriptions.map(d => [`${d.classid}_${d.instanceid || '0'}`, d]));
    return assets.map(asset => {
      const description = map.get(`${asset.classid}_${asset.instanceid || '0'}`) || {};
      return decorateInventoryItem({
        ...asset,
        assetid: String(asset.assetid),
        contextid: String(asset.contextid || '6'),
        classid: String(asset.classid || ''),
        instanceid: String(asset.instanceid || '0'),
        description,
        owner_actions: description.owner_actions || [],
        tags: description.tags || [],
        name: description.name || asset.name || '',
        market_name: description.market_name || description.name || asset.name || '',
        type: description.type || asset.type || '',
        market_fee_app: description.market_fee_app || asset.market_fee_app || null
      });
    });
  }

  function games(items) {
    const groups = new Map();
    for (const item of items) {
      if (!item.gooAppId) continue;
      if (!groups.has(item.gooAppId)) groups.set(item.gooAppId, { appId: item.gooAppId, name: item.appName, count: 0, itemKeys: new Set(), typeKeys: new Set() });
      const group = groups.get(item.gooAppId);
      group.count++;
      group.itemKeys.add(item.itemKey);
      group.typeKeys.add(item.typeKey);
      if (group.name === 'Unknown Game' && item.appName !== 'Unknown Game') group.name = item.appName;
    }
    return Array.from(groups.values(), group => ({
      appId: group.appId, name: group.name, count: group.count,
      uniqueItems: group.itemKeys.size, uniqueTypes: group.typeKeys.size
    })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  function filterGroups(items) {
    const groups = new Map();
    for (const item of items) {
      if (!groups.has(item.itemKey)) groups.set(item.itemKey, { key: item.itemKey, label: item.itemName, count: 0 });
      groups.get(item.itemKey).count++;
    }
    return Array.from(groups.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }

  SGC.inventory = { join, canTurnIntoGems, games, filterGroups };
})();
