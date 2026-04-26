import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Filter, X, Check, Plus, ShoppingCart, ChefHat,
  Calendar, Star, Trash2, Edit3, AlertCircle, ChevronRight,
  Copy, ExternalLink, BookOpen, Sparkles, Clock,
  Tag as TagIcon, Cloud, CloudOff
} from 'lucide-react';
import {
  collection, doc, onSnapshot, setDoc, deleteDoc,
  writeBatch, getDocs
} from 'firebase/firestore';
import { db } from './firebase';
import { SEED_RECIPES, SEED_INGREDIENTS, CATEGORY_COLORS } from './seedData';
import { styles, globalCss } from './styles';

const daysSince = (d) => d ? Math.floor((new Date() - new Date(d)) / 86400000) : null;
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const getRecipeStats = (recipe, log) => {
  const entries = log.filter(l => l.recipeId === recipe.id && l.status === 'made');
  const ratings = entries.filter(e => e.rating).map(e => e.rating);
  const lastMade = entries.length ? entries.reduce((a, b) => a.date > b.date ? a : b).date : null;
  return {
    timesMade: entries.length,
    avgRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
    lastMade,
    daysSince: daysSince(lastMade),
  };
};

async function seedIfEmpty() {
  const snap = await getDocs(collection(db, 'recipes'));
  if (!snap.empty) return;
  const batch = writeBatch(db);
  SEED_RECIPES.forEach(r => batch.set(doc(db, 'recipes', r.id), r));
  SEED_INGREDIENTS.forEach(ing => {
    const id = newId();
    batch.set(doc(db, 'ingredients', id), { ...ing, id });
  });
  await batch.commit();
}

const pageAnim = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.25 },
};

export default function App() {
  const [view, setView] = useState('week');
  const [recipes, setRecipes] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [log, setLog] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [purchased, setPurchased] = useState(new Set());
  const [restockItems, setRestockItems] = useState(new Set());
  const [search, setSearch] = useState('');
  const [filterTags, setFilterTags] = useState(new Set());
  const [filterCat, setFilterCat] = useState(null);
  const [hideRecent, setHideRecent] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState(null);
  const [showAddRecipe, setShowAddRecipe] = useState(false);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState('connecting');
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsubs = [];
    (async () => {
      try {
        await seedIfEmpty();
        unsubs.push(onSnapshot(collection(db, 'recipes'),
          s => { setRecipes(s.docs.map(d => ({ id: d.id, ...d.data() }))); setSyncStatus('synced'); },
          e => { console.error(e); setSyncStatus('offline'); setError('Connection issue. Changes may not save.'); }));
        unsubs.push(onSnapshot(collection(db, 'ingredients'),
          s => setIngredients(s.docs.map(d => ({ id: d.id, ...d.data() })))));
        unsubs.push(onSnapshot(collection(db, 'cookLog'),
          s => setLog(s.docs.map(d => ({ id: d.id, ...d.data() })))));
        unsubs.push(onSnapshot(doc(db, 'state', 'currentWeek'), s => {
          if (s.exists()) {
            const d = s.data();
            setSelected(new Set(d.selected || []));
            setPurchased(new Set(d.purchased || []));
            setRestockItems(new Set(d.restock || []));
          }
        }));
        setLoading(false);
      } catch (e) {
        console.error(e);
        setError('Setup failed: ' + e.message);
        setLoading(false);
      }
    })();
    return () => unsubs.forEach(u => u && u());
  }, []);

  useEffect(() => {
    const on = () => setSyncStatus('synced');
    const off = () => setSyncStatus('offline');
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2200); };

  const updateWeekState = async (next) => {
    try {
      await setDoc(doc(db, 'state', 'currentWeek'), {
        selected: [...(next.selected ?? selected)],
        purchased: [...(next.purchased ?? purchased)],
        restock: [...(next.restock ?? restockItems)],
      });
    } catch (e) { console.error(e); }
  };

  const toggleSelect = (id) => {
    const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id);
    setSelected(n); updateWeekState({ selected: n });
  };
  const togglePurchased = (k) => {
    const n = new Set(purchased); n.has(k) ? n.delete(k) : n.add(k);
    setPurchased(n); updateWeekState({ purchased: n });
  };
  const toggleRestock = (k) => {
    const n = new Set(restockItems); n.has(k) ? n.delete(k) : n.add(k);
    setRestockItems(n); updateWeekState({ restock: n });
  };

  const submitWeek = async () => {
    if (!selected.size) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const batch = writeBatch(db);
      [...selected].forEach(id => {
        const lid = newId();
        batch.set(doc(db, 'cookLog', lid), { id: lid, date: today, recipeId: id, status: 'planned', rating: null });
      });
      await batch.commit();
      const empty = new Set();
      setSelected(empty); setPurchased(empty); setRestockItems(empty);
      await updateWeekState({ selected: empty, purchased: empty, restock: empty });
      showToast('Week archived. Log meals as you cook them.');
      setView('log');
    } catch (e) { showToast('Could not archive — try again.'); console.error(e); }
  };

  const logMeal = async (recipeId, status, rating) => {
    try {
      const id = newId();
      await setDoc(doc(db, 'cookLog', id), {
        id, date: new Date().toISOString().slice(0, 10),
        recipeId, status, rating: rating || null,
      });
      showToast(status === 'made' ? 'Logged ✓' : 'Marked skipped');
    } catch { showToast('Could not save — try again.'); }
  };

  const deleteLogEntry = async (id) => {
    try { await deleteDoc(doc(db, 'cookLog', id)); }
    catch { showToast('Could not delete — try again.'); }
  };

  const saveRecipe = async (recipe, recipeIngs) => {
    try {
      const isNew = !recipe.id;
      const id = isNew ? newId() : recipe.id;
      await setDoc(doc(db, 'recipes', id), { ...recipe, id });
      const existing = ingredients.filter(i => i.recipeId === id);
      const batch = writeBatch(db);
      existing.forEach(i => batch.delete(doc(db, 'ingredients', i.id)));
      recipeIngs.forEach(ing => {
        const ingId = newId();
        batch.set(doc(db, 'ingredients', ingId), { ...ing, id: ingId, recipeId: id });
      });
      await batch.commit();
      setEditingRecipe(null); setShowAddRecipe(false);
      showToast(isNew ? 'Recipe added' : 'Recipe updated');
    } catch (e) { showToast('Could not save — try again.'); console.error(e); }
  };

  const deleteRecipe = async (id) => {
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'recipes', id));
      ingredients.filter(i => i.recipeId === id).forEach(i => batch.delete(doc(db, 'ingredients', i.id)));
      await batch.commit();
      setEditingRecipe(null); showToast('Recipe deleted');
    } catch { showToast('Could not delete — try again.'); }
  };

  const allTags = useMemo(() => {
    const s = new Set();
    recipes.forEach(r => (r.tags || []).forEach(t => s.add(t)));
    return [...s].sort();
  }, [recipes]);

  const filteredRecipes = useMemo(() => {
    return recipes.filter(r => {
      if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterCat && r.category !== filterCat) return false;
      if (filterTags.size && ![...filterTags].every(t => (r.tags || []).includes(t))) return false;
      if (hideRecent) {
        const s = getRecipeStats(r, log);
        if (s.daysSince !== null && s.daysSince < (r.repeatWeeks || 2) * 7) return false;
      }
      return true;
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [recipes, search, filterCat, filterTags, hideRecent, log]);

  const groceryList = useMemo(() => {
    const sel = ingredients.filter(i => selected.has(i.recipeId));
    const visible = sel.filter(i => !i.staple || restockItems.has(`${i.recipeId}-${i.name}`));
    const grouped = {};
    const seen = new Map();
    visible.forEach(ing => {
      const key = ing.combine ? ing.name.toLowerCase() : `${ing.name.toLowerCase()}|${ing.recipeId}`;
      if (seen.has(key)) seen.get(key).recipeIds.push(ing.recipeId);
      else {
        const e = { name: ing.name, qty: ing.qty, cat: ing.cat, kroger: ing.kroger, combine: ing.combine, recipeIds: [ing.recipeId] };
        seen.set(key, e);
        if (!grouped[ing.cat]) grouped[ing.cat] = [];
        grouped[ing.cat].push(e);
      }
    });
    return grouped;
  }, [selected, ingredients, restockItems]);

  const totalGroceryItems = useMemo(() =>
    Object.values(groceryList).reduce((s, a) => s + a.length, 0), [groceryList]);

  const copyKrogerList = () => {
    const all = Object.values(groceryList).flat().map(i => i.kroger).join(', ');
    navigator.clipboard?.writeText(all);
    showToast('Copied to clipboard');
  };

  const openInKroger = (term) => {
    window.open(`https://www.kroger.com/search?query=${encodeURIComponent(term)}`, '_blank');
  };

  if (loading) {
    return (
      <div style={{ ...styles.app, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <style>{globalCss}</style>
        <div style={{ textAlign: 'center' }}>
          <div style={{ ...styles.brandMark, margin: '0 auto 16px' }}>※</div>
          <div style={{ fontSize: 13, color: '#9b8c7a', letterSpacing: '0.08em' }}>connecting…</div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.app}>
      <style>{globalCss}</style>
      <Header view={view} setView={setView} selectedCount={selected.size} syncStatus={syncStatus} />
      {error && <div style={styles.errorBar}><AlertCircle size={14} strokeWidth={1.6} />{error}</div>}
      <main style={styles.main}>
        <AnimatePresence mode="wait">
          {view === 'week' && <motion.div key="week" {...pageAnim}>
            <WeekView {...{ recipes: filteredRecipes, allRecipesCount: recipes.length, log, selected, toggleSelect, search, setSearch, filterTags, setFilterTags, filterCat, setFilterCat, hideRecent, setHideRecent, allTags, onAdd: () => setShowAddRecipe(true), onEdit: setEditingRecipe, onSubmit: submitWeek }} />
          </motion.div>}
          {view === 'recipes' && <motion.div key="recipes" {...pageAnim}>
            <RecipesView {...{ recipes, ingredients, log, onEdit: setEditingRecipe, onAdd: () => setShowAddRecipe(true) }} />
          </motion.div>}
          {view === 'shopping' && <motion.div key="shopping" {...pageAnim}>
            <ShoppingView {...{ groceryList, recipes, selected, ingredients, restockItems, toggleRestock, purchased, togglePurchased, totalCount: totalGroceryItems, onCopy: copyKrogerList, onOpenKroger: openInKroger, onSubmit: submitWeek }} />
          </motion.div>}
          {view === 'log' && <motion.div key="log" {...pageAnim}>
            <LogView {...{ log, recipes, onLog: logMeal, onDelete: deleteLogEntry }} />
          </motion.div>}
          {view === 'wrapped' && <motion.div key="wrapped" {...pageAnim}>
            <WrappedView {...{ recipes, ingredients, log }} />
          </motion.div>}
        </AnimatePresence>
      </main>
      <AnimatePresence>
        {(editingRecipe || showAddRecipe) && (
          <RecipeEditor recipe={editingRecipe} ingredients={ingredients} onSave={saveRecipe}
            onDelete={editingRecipe ? () => deleteRecipe(editingRecipe.id) : null}
            onClose={() => { setEditingRecipe(null); setShowAddRecipe(false); }} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {toast && <motion.div style={styles.toast}
          initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}>
          {toast}</motion.div>}
      </AnimatePresence>
    </div>
  );
}

function Header({ view, setView, selectedCount, syncStatus }) {
  const tabs = [
    { id: 'week', label: 'This Week', icon: Calendar },
    { id: 'recipes', label: 'Recipes', icon: BookOpen },
    { id: 'shopping', label: 'Shopping', icon: ShoppingCart, badge: selectedCount },
    { id: 'log', label: 'Cook Log', icon: ChefHat },
    { id: 'wrapped', label: 'Wrapped', icon: Sparkles },
  ];
  return (
    <header style={styles.header}>
      <div style={styles.headerInner}>
        <div style={styles.brand}>
          <div style={styles.brandMark}>※</div>
          <div>
            <div style={styles.brandTitle}>The Table</div>
            <div style={styles.brandSubtitle}>
              {syncStatus === 'synced' && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Cloud size={10} strokeWidth={1.6} /> synced</span>}
              {syncStatus === 'offline' && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#a85a4d' }}><CloudOff size={10} strokeWidth={1.6} /> offline</span>}
              {syncStatus === 'connecting' && 'connecting…'}
            </div>
          </div>
        </div>
        <nav style={styles.nav}>
          {tabs.map(t => {
            const Icon = t.icon, active = view === t.id;
            return <button key={t.id} onClick={() => setView(t.id)}
              style={{ ...styles.navBtn, ...(active ? styles.navBtnActive : {}) }}>
              <Icon size={15} strokeWidth={1.6} /><span>{t.label}</span>
              {t.badge > 0 && <span style={styles.badge}>{t.badge}</span>}
            </button>;
          })}
        </nav>
      </div>
    </header>
  );
}

function WeekView({ recipes, allRecipesCount, log, selected, toggleSelect, search, setSearch, filterTags, setFilterTags, filterCat, setFilterCat, hideRecent, setHideRecent, allTags, onAdd, onEdit, onSubmit }) {
  const [showFilters, setShowFilters] = useState(false);
  const cats = ['Breakfast', 'Lunch', 'Dinner', 'Side Dish', 'Dessert', 'Snack'];
  const toggleTag = (t) => { const n = new Set(filterTags); n.has(t) ? n.delete(t) : n.add(t); setFilterTags(n); };
  const clearFilters = () => { setFilterTags(new Set()); setFilterCat(null); setHideRecent(false); setSearch(''); };
  const hasFilters = filterTags.size || filterCat || hideRecent || search;
  return (<>
    <div style={styles.pageHead}>
      <div>
        <div style={styles.eyebrow}>Week of {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</div>
        <h1 style={styles.h1}>Pick this week's meals</h1>
      </div>
      <div style={styles.weekStat}>
        <div style={styles.weekStatNum}>{selected.size}</div>
        <div style={styles.weekStatLabel}>{selected.size === 1 ? 'meal' : 'meals'} selected</div>
      </div>
    </div>
    {allRecipesCount === 0 && <div style={styles.empty}>
      <div style={{ fontSize: 14, color: '#7a6c5d', marginBottom: 12 }}>No recipes yet. Add your first one to get started.</div>
      <button onClick={onAdd} style={styles.toolBtnPrimary}><Plus size={14} strokeWidth={1.6} /> Add a recipe</button>
    </div>}
    {allRecipesCount > 0 && <>
      <div style={styles.toolbar}>
        <div style={styles.searchBox}>
          <Search size={16} strokeWidth={1.6} style={{ color: '#9b8c7a' }} />
          <input placeholder="Search meals…" value={search} onChange={e => setSearch(e.target.value)} style={styles.searchInput} />
          {search && <button onClick={() => setSearch('')} style={styles.iconBtn}><X size={14} strokeWidth={1.6} /></button>}
        </div>
        <button onClick={() => setShowFilters(!showFilters)} style={{ ...styles.toolBtn, ...(showFilters || hasFilters ? styles.toolBtnActive : {}) }}>
          <Filter size={14} strokeWidth={1.6} /> Filters {hasFilters ? `(${(filterTags.size + (filterCat ? 1 : 0) + (hideRecent ? 1 : 0))})` : ''}
        </button>
        <button onClick={onAdd} style={styles.toolBtnPrimary}><Plus size={14} strokeWidth={1.6} /> New</button>
      </div>
      <AnimatePresence>{showFilters && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
        <div style={styles.filterPanel}>
          <div style={styles.filterRow}><div style={styles.filterLabel}>Category</div><div style={styles.chipRow}>
            {cats.map(c => <button key={c} onClick={() => setFilterCat(filterCat === c ? null : c)} style={{ ...styles.chip, ...(filterCat === c ? styles.chipActive : {}) }}>{c}</button>)}
          </div></div>
          {allTags.length > 0 && <div style={styles.filterRow}><div style={styles.filterLabel}>Tags</div><div style={styles.chipRow}>
            {allTags.map(t => <button key={t} onClick={() => toggleTag(t)} style={{ ...styles.chip, ...(filterTags.has(t) ? styles.chipActive : {}) }}>{t}</button>)}
          </div></div>}
          <div style={styles.filterRow}><div style={styles.filterLabel}>Quick</div><div style={styles.chipRow}>
            <button onClick={() => setHideRecent(!hideRecent)} style={{ ...styles.chip, ...(hideRecent ? styles.chipActive : {}) }}>Hide recently made</button>
            {hasFilters && <button onClick={clearFilters} style={styles.chipClear}>Clear all</button>}
          </div></div>
        </div>
      </motion.div>}</AnimatePresence>
      <div style={styles.grid}>
        {recipes.map(r => {
          const stats = getRecipeStats(r, log);
          const isSelected = selected.has(r.id);
          const tooSoon = stats.daysSince !== null && stats.daysSince < (r.repeatWeeks || 2) * 7;
          return <RecipeCard key={r.id} recipe={r} stats={stats} isSelected={isSelected} tooSoon={tooSoon} onToggle={() => toggleSelect(r.id)} onEdit={() => onEdit(r)} />;
        })}
        {recipes.length === 0 && <div style={styles.empty}>
          <div style={{ fontSize: 14, color: '#9b8c7a' }}>No meals match these filters.</div>
          <button onClick={clearFilters} style={{ ...styles.toolBtn, marginTop: 12 }}>Clear filters</button>
        </div>}
      </div>
    </>}
    {selected.size > 0 && <motion.div style={styles.stickyBar} initial={{ y: 80 }} animate={{ y: 0 }}>
      <div>
        <div style={styles.stickyText}>{selected.size} {selected.size === 1 ? 'meal' : 'meals'} for this week</div>
        <div style={styles.stickySub}>Tap shopping to see your list</div>
      </div>
      <button onClick={onSubmit} style={styles.stickyBtn}>Archive week <ChevronRight size={16} strokeWidth={1.6} /></button>
    </motion.div>}
  </>);
}

function RecipeCard({ recipe, stats, isSelected, tooSoon, onToggle, onEdit }) {
  return (<motion.div whileHover={{ y: -2 }} transition={{ type: 'spring', stiffness: 300, damping: 25 }}
    style={{ ...styles.card, ...(isSelected ? styles.cardSelected : {}) }}>
    <button onClick={onToggle} style={styles.cardMain}>
      <div style={styles.cardTop}>
        <div style={styles.cardCat}>{recipe.category}</div>
        <div style={{ ...styles.checkBox, ...(isSelected ? styles.checkBoxOn : {}) }}>{isSelected && <Check size={12} strokeWidth={2.5} />}</div>
      </div>
      <div style={styles.cardName}>{recipe.name}</div>
      <div style={styles.cardTags}>{(recipe.tags || []).slice(0, 3).map(t => <span key={t} style={styles.cardTag}>{t}</span>)}</div>
      <div style={styles.cardFoot}>
        {stats.timesMade > 0 ? <>
          <span style={styles.cardStatItem}>{stats.avgRating ? '★ ' + stats.avgRating.toFixed(1) : '—'}</span>
          <span style={styles.cardStatItem}>made {stats.timesMade}×</span>
          {stats.daysSince !== null && <span style={{ ...styles.cardStatItem, ...(tooSoon ? styles.cardStatWarn : {}) }}>
            {tooSoon && <AlertCircle size={11} strokeWidth={2} style={{ verticalAlign: -1, marginRight: 3 }} />}
            {stats.daysSince === 0 ? 'today' : `${stats.daysSince}d ago`}
          </span>}
        </> : <span style={{ ...styles.cardStatItem, color: '#9b8c7a' }}>never made</span>}
      </div>
    </button>
    <button onClick={onEdit} style={styles.cardEditBtn} title="Edit"><Edit3 size={13} strokeWidth={1.6} /></button>
  </motion.div>);
}

function RecipesView({ recipes, ingredients, log, onEdit, onAdd }) {
  const [search, setSearch] = useState('');
  const filtered = recipes.filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  return (<>
    <div style={styles.pageHead}>
      <div>
        <div style={styles.eyebrow}>{recipes.length} {recipes.length === 1 ? 'meal' : 'meals'} in your library</div>
        <h1 style={styles.h1}>Your recipes</h1>
      </div>
      <button onClick={onAdd} style={styles.toolBtnPrimary}><Plus size={14} strokeWidth={1.6} /> Add recipe</button>
    </div>
    {recipes.length > 0 && <div style={styles.toolbar}>
      <div style={styles.searchBox}>
        <Search size={16} strokeWidth={1.6} style={{ color: '#9b8c7a' }} />
        <input placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} style={styles.searchInput} />
      </div>
    </div>}
    <div style={styles.list}>
      {filtered.map(r => {
        const stats = getRecipeStats(r, log);
        const ingCount = ingredients.filter(i => i.recipeId === r.id).length;
        return <button key={r.id} onClick={() => onEdit(r)} style={styles.listItem}>
          <div>
            <div style={styles.listItemName}>{r.name}</div>
            <div style={styles.listItemMeta}>
              {r.category} · {ingCount} {ingCount === 1 ? 'ingredient' : 'ingredients'}
              {stats.timesMade > 0 && ` · made ${stats.timesMade}×`}
              {stats.avgRating && ` · ★ ${stats.avgRating.toFixed(1)}`}
            </div>
          </div>
          <ChevronRight size={18} strokeWidth={1.6} style={{ color: '#9b8c7a' }} />
        </button>;
      })}
      {recipes.length === 0 && <div style={styles.empty}>
        <div style={{ fontSize: 14, color: '#7a6c5d', marginBottom: 12 }}>No recipes yet.</div>
        <button onClick={onAdd} style={styles.toolBtnPrimary}><Plus size={14} strokeWidth={1.6} /> Add your first</button>
      </div>}
    </div>
  </>);
}

function ShoppingView({ groceryList, recipes, selected, ingredients, restockItems, toggleRestock, purchased, togglePurchased, totalCount, onCopy, onOpenKroger, onSubmit }) {
  const cats = Object.keys(groceryList);
  const stapleIngs = ingredients.filter(i => i.staple && selected.has(i.recipeId)).reduce((acc, i) => {
    const key = `${i.recipeId}-${i.name}`;
    if (!acc.find(x => x.name === i.name)) acc.push({ ...i, key });
    return acc;
  }, []);
  if (selected.size === 0) return (<div style={styles.emptyState}>
    <ShoppingCart size={32} strokeWidth={1.2} style={{ color: '#9b8c7a' }} />
    <h2 style={{ ...styles.h1, marginTop: 16 }}>Nothing on the list yet</h2>
    <div style={{ color: '#7a6c5d', marginTop: 8 }}>Pick some meals on This Week to see your grocery list.</div>
  </div>);
  return (<>
    <div style={styles.pageHead}>
      <div>
        <div style={styles.eyebrow}>{totalCount} {totalCount === 1 ? 'item' : 'items'} · {selected.size} {selected.size === 1 ? 'meal' : 'meals'}</div>
        <h1 style={styles.h1}>Grocery list</h1>
      </div>
      <button onClick={onCopy} style={styles.toolBtn}><Copy size={14} strokeWidth={1.6} /> Copy all</button>
    </div>
    <div style={styles.shopWrap}>
      {cats.map(cat => {
        const items = groceryList[cat];
        const c = CATEGORY_COLORS[cat] || { dot: '#9b8c7a', text: '#5a4530' };
        return <section key={cat} style={styles.shopSection}>
          <div style={{ ...styles.shopHead, color: c.text }}>
            <span style={{ ...styles.catDot, background: c.dot }} />{cat}
            <span style={styles.shopCount}>{items.length}</span>
          </div>
          <div>{items.map((item, i) => {
            const key = `${cat}-${item.name}-${i}`;
            const isPurchased = purchased.has(key);
            return <div key={key} style={{ ...styles.shopRow, ...(isPurchased ? styles.shopRowDone : {}) }}>
              <button onClick={() => togglePurchased(key)} style={{ ...styles.checkBox, ...(isPurchased ? styles.checkBoxOn : {}) }}>
                {isPurchased && <Check size={12} strokeWidth={2.5} />}
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={styles.shopName}>{item.name}</div>
                <div style={styles.shopMeta}>
                  {item.qty}
                  {item.combine && item.recipeIds.length > 1 && <span style={styles.combinedTag}> · combined ({item.recipeIds.length})</span>}
                  <span style={styles.shopRecipe}> · {item.recipeIds.map(id => recipes.find(r => r.id === id)?.name).filter(Boolean).join(', ')}</span>
                </div>
              </div>
              <button onClick={() => onOpenKroger(item.kroger)} style={styles.krogerBtn} title="Open in Kroger">
                <ExternalLink size={13} strokeWidth={1.6} />
              </button>
            </div>;
          })}</div>
        </section>;
      })}
      {stapleIngs.length > 0 && <section style={styles.shopSection}>
        <div style={{ ...styles.shopHead, color: '#7a6c5d' }}>
          <span style={{ ...styles.catDot, background: '#9b8c7a' }} />Pantry staples
          <span style={styles.shopCount}>excluded by default</span>
        </div>
        <div style={styles.stapleHint}>Tap to mark for restock — it'll move to your list.</div>
        <div>{stapleIngs.map(item => {
          const isRestock = restockItems.has(item.key);
          return <button key={item.key} onClick={() => toggleRestock(item.key)} style={{ ...styles.shopRow, ...styles.stapleRow, ...(isRestock ? styles.stapleRowOn : {}) }}>
            <div style={{ ...styles.checkBox, ...(isRestock ? styles.checkBoxOn : {}) }}>{isRestock && <Check size={12} strokeWidth={2.5} />}</div>
            <div style={{ flex: 1, textAlign: 'left' }}>
              <div style={styles.shopName}>{item.name}</div>
              <div style={styles.shopMeta}>{item.qty}</div>
            </div>
          </button>;
        })}</div>
      </section>}
    </div>
    <div style={styles.shopFooter}>
      <button onClick={onSubmit} style={styles.stickyBtn}>Done shopping — archive week <ChevronRight size={16} strokeWidth={1.6} /></button>
    </div>
  </>);
}

function LogView({ log, recipes, onLog, onDelete }) {
  const [showAdd, setShowAdd] = useState(false);
  const [pendingId, setPendingId] = useState(null);
  const [pendingRating, setPendingRating] = useState(0);
  const sorted = [...log].sort((a, b) => b.date.localeCompare(a.date));
  const recent = sorted.slice(0, 30);
  const planned = sorted.filter(l => l.status === 'planned');
  const submitRating = (status) => {
    if (!pendingId) return;
    onLog(pendingId, status, status === 'made' ? (pendingRating || null) : null);
    setPendingId(null); setPendingRating(0); setShowAdd(false);
  };
  return (<>
    <div style={styles.pageHead}>
      <div>
        <div style={styles.eyebrow}>{log.filter(l => l.status === 'made').length} cooked · {log.filter(l => l.status === 'skipped').length} skipped</div>
        <h1 style={styles.h1}>Cook log</h1>
      </div>
      <button onClick={() => setShowAdd(true)} style={styles.toolBtnPrimary}><Plus size={14} strokeWidth={1.6} /> Log meal</button>
    </div>
    {planned.length > 0 && <div style={styles.plannedBanner}>
      <Clock size={14} strokeWidth={1.6} />
      {planned.length} {planned.length === 1 ? 'meal' : 'meals'} from this week's plan still need logging
    </div>}
    <AnimatePresence>{showAdd && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
      <div style={styles.logForm}>
        <div style={styles.filterLabel}>Which meal?</div>
        <select value={pendingId || ''} onChange={e => setPendingId(e.target.value)} style={styles.select}>
          <option value="">Pick one…</option>
          {recipes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        {pendingId && <>
          <div style={{ ...styles.filterLabel, marginTop: 14 }}>Rating (if made)</div>
          <div style={styles.starRow}>
            {[1, 2, 3, 4, 5].map(n => <button key={n} onClick={() => setPendingRating(n)} style={styles.starBtn}>
              <Star size={26} strokeWidth={1.4} fill={n <= pendingRating ? '#c8a04c' : 'none'} color={n <= pendingRating ? '#c8a04c' : '#c4b8a8'} />
            </button>)}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <button onClick={() => submitRating('made')} style={styles.toolBtnPrimary}><Check size={14} strokeWidth={1.6} /> Made it</button>
            <button onClick={() => submitRating('skipped')} style={styles.toolBtn}>Skipped</button>
            <button onClick={() => { setShowAdd(false); setPendingId(null); }} style={styles.toolBtn}>Cancel</button>
          </div>
        </>}
      </div>
    </motion.div>}</AnimatePresence>
    <div style={styles.list}>
      {recent.map(entry => {
        const recipe = recipes.find(r => r.id === entry.recipeId);
        if (!recipe) return null;
        return <div key={entry.id} style={styles.listItem}>
          <div>
            <div style={styles.listItemName}>{recipe.name}</div>
            <div style={styles.listItemMeta}>
              {new Date(entry.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ·
              <span style={{ color: entry.status === 'made' ? '#5a7a4d' : entry.status === 'skipped' ? '#a85a4d' : '#7a6c5d', fontWeight: 500, marginLeft: 4 }}>{entry.status}</span>
              {entry.rating && <span style={{ color: '#c8a04c', marginLeft: 8 }}>{'★'.repeat(entry.rating)}</span>}
            </div>
          </div>
          <button onClick={() => onDelete(entry.id)} style={styles.iconBtn}><Trash2 size={14} strokeWidth={1.6} /></button>
        </div>;
      })}
      {recent.length === 0 && <div style={styles.empty}><div style={{ fontSize: 14, color: '#9b8c7a' }}>No meals logged yet.</div></div>}
    </div>
  </>);
}

function WrappedView({ recipes, ingredients, log }) {
  const year = new Date().getFullYear();
  const yearLog = log.filter(l => l.date && l.date.startsWith(String(year)));
  const made = yearLog.filter(l => l.status === 'made');
  const skipped = yearLog.filter(l => l.status === 'skipped');
  const stats = useMemo(() => {
    const counts = {}, ratings = {};
    made.forEach(e => { counts[e.recipeId] = (counts[e.recipeId] || 0) + 1; if (e.rating) (ratings[e.recipeId] = ratings[e.recipeId] || []).push(e.rating); });
    const ranked = Object.entries(counts).map(([id, c]) => {
      const r = recipes.find(rec => rec.id === id);
      const rs = ratings[id] || [];
      return r ? { recipe: r, count: c, avg: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null } : null;
    }).filter(Boolean).sort((a, b) => b.count - a.count);
    const topByCat = {};
    ['Breakfast', 'Lunch', 'Dinner', 'Side Dish', 'Dessert', 'Snack'].forEach(c => { const t = ranked.find(r => r.recipe.category === c); if (t) topByCat[c] = t; });
    const highest = ranked.filter(r => r.count >= 2 && r.avg).sort((a, b) => b.avg - a.avg)[0];
    const skipCounts = {};
    skipped.forEach(e => { skipCounts[e.recipeId] = (skipCounts[e.recipeId] || 0) + 1; });
    const ms = Object.entries(skipCounts).sort((a, b) => b[1] - a[1])[0];
    const mostSkipped = ms ? { recipe: recipes.find(r => r.id === ms[0]), count: ms[1] } : null;
    const longestGap = recipes.map(r => ({ recipe: r, days: getRecipeStats(r, log).daysSince })).filter(x => x.days !== null).sort((a, b) => b.days - a.days)[0];
    const tagCounts = {};
    made.forEach(e => { const r = recipes.find(rec => rec.id === e.recipeId); if (r) (r.tags || []).forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }); });
    const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const months = Array.from({ length: 12 }, (_, m) => {
      const ms = made.filter(e => Number(e.date.slice(5, 7)) === m + 1);
      const rs = ms.filter(e => e.rating).map(e => e.rating);
      return { month: new Date(2000, m, 1).toLocaleDateString('en-US', { month: 'short' }), count: ms.length, avg: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null };
    });
    const maxMonth = Math.max(1, ...months.map(m => m.count));
    const ingCounts = {};
    made.forEach(e => { ingredients.filter(i => i.recipeId === e.recipeId).forEach(i => { ingCounts[i.name] = (ingCounts[i.name] || 0) + 1; }); });
    const topIngs = Object.entries(ingCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const allRatings = Object.values(ratings).flat();
    return { total: made.length, skipped: skipped.length, unique: Object.keys(counts).length, avg: allRatings.length ? allRatings.reduce((a, b) => a + b, 0) / allRatings.length : null, ranked, topByCat, highest, mostSkipped, longestGap, topTags, months, maxMonth, topIngs };
  }, [recipes, ingredients, log, made, skipped]);
  return (<>
    <div style={styles.pageHead}><div><div style={styles.eyebrow}>{year} in cooking</div><h1 style={styles.h1}>Wrapped</h1></div></div>
    <div style={styles.wrapGrid}>
      <BigStat label="meals cooked" value={stats.total} accent="#7BA05B" />
      <BigStat label="unique recipes" value={stats.unique} accent="#B89556" />
      <BigStat label="avg rating" value={stats.avg ? '★ ' + stats.avg.toFixed(2) : '—'} accent="#C8A04C" />
      <BigStat label="meals skipped" value={stats.skipped} accent="#B85450" />
    </div>
    <Section title="Top of the year">
      {stats.ranked.length === 0 ? <Empty>Nothing logged yet for {year}.</Empty> :
        <ol style={styles.podium}>{stats.ranked.slice(0, 5).map((r, i) =>
          <li key={r.recipe.id} style={styles.podiumRow}>
            <div style={styles.podiumRank}>{i + 1}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={styles.podiumName}>{r.recipe.name}</div>
              <div style={styles.podiumMeta}>{r.recipe.category}{r.avg && <> · ★ {r.avg.toFixed(1)}</>}</div>
            </div>
            <div style={styles.podiumCount}>{r.count}<span style={styles.podiumX}>×</span></div>
          </li>)}</ol>}
    </Section>
    <div style={styles.twoCol}>
      <Section title="By category">
        {Object.keys(stats.topByCat).length === 0 ? <Empty>No data yet.</Empty> : <div style={styles.list}>
          {Object.entries(stats.topByCat).map(([cat, item]) => <div key={cat} style={styles.byCatRow}>
            <div style={styles.byCatCat}>{cat}</div>
            <div style={styles.byCatName}>{item.recipe.name}</div>
            <div style={styles.byCatCount}>{item.count}×</div>
          </div>)}
        </div>}
      </Section>
      <Section title="Notable">
        <div style={styles.list}>
          {stats.highest && <NotableRow label="Highest rated" name={stats.highest.recipe.name} sub={`★ ${stats.highest.avg.toFixed(2)} · made ${stats.highest.count}×`} />}
          {stats.mostSkipped && <NotableRow label="Most skipped" name={stats.mostSkipped.recipe.name} sub={`skipped ${stats.mostSkipped.count}×`} />}
          {stats.longestGap && <NotableRow label="Forgotten meal" name={stats.longestGap.recipe.name} sub={`${stats.longestGap.days} days since you made it`} />}
          {!stats.highest && !stats.mostSkipped && !stats.longestGap && <Empty>No data yet.</Empty>}
        </div>
      </Section>
    </div>
    <Section title="By month">
      <div style={styles.monthChart}>{stats.months.map((m, i) =>
        <div key={i} style={styles.monthCol}>
          <div style={styles.monthBarWrap}><div style={{ ...styles.monthBar, height: `${(m.count / stats.maxMonth) * 100}%`, opacity: m.count ? 1 : 0.15 }} /></div>
          <div style={styles.monthCount}>{m.count || ''}</div>
          <div style={styles.monthLabel}>{m.month}</div>
        </div>)}
      </div>
    </Section>
    <div style={styles.twoCol}>
      <Section title="Top tags">
        {stats.topTags.length === 0 ? <Empty>No tags yet.</Empty> : <div style={styles.tagWrap}>
          {stats.topTags.map(([tag, count], i) => <div key={tag} style={{ ...styles.tagBig, fontSize: 13 + (6 - i) * 2 }}>
            <TagIcon size={11} strokeWidth={1.6} />{tag} <span style={{ color: '#9b8c7a', fontWeight: 400 }}>{count}</span>
          </div>)}
        </div>}
      </Section>
      <Section title="Most-bought items">
        {stats.topIngs.length === 0 ? <Empty>Cook more to see this.</Empty> : <div style={styles.list}>
          {stats.topIngs.map(([name, count]) => <div key={name} style={styles.ingRow}><span>{name}</span><span style={styles.ingCount}>{count}</span></div>)}
        </div>}
      </Section>
    </div>
  </>);
}

function NotableRow({ label, name, sub }) { return (<div style={styles.notableRow}><div style={styles.notableLabel}>{label}</div><div style={styles.notableValue}>{name}</div><div style={styles.notableSub}>{sub}</div></div>); }
function BigStat({ label, value, accent }) { return (<motion.div style={styles.bigStat} whileHover={{ y: -2 }}><div style={{ ...styles.bigStatBar, background: accent }} /><div style={styles.bigStatValue}>{value}</div><div style={styles.bigStatLabel}>{label}</div></motion.div>); }
function Section({ title, children }) { return (<section style={styles.section}><div style={styles.sectionTitle}>{title}</div><div style={styles.sectionBody}>{children}</div></section>); }
function Empty({ children }) { return <div style={styles.empty}><div style={{ color: '#9b8c7a', fontSize: 13 }}>{children}</div></div>; }

function RecipeEditor({ recipe, ingredients, onSave, onDelete, onClose }) {
  const isNew = !recipe;
  const [form, setForm] = useState(recipe || { name: '', category: 'Dinner', tags: [], repeatWeeks: 2, notes: '' });
  const [tagInput, setTagInput] = useState('');
  const [recipeIngs, setRecipeIngs] = useState(recipe ? ingredients.filter(i => i.recipeId === recipe.id) : []);
  const [newIng, setNewIng] = useState({ name: '', qty: '', cat: 'Produce', kroger: '', staple: false, combine: false });
  const cats = ['Breakfast', 'Lunch', 'Dinner', 'Side Dish', 'Dessert', 'Snack'];
  const groceryCats = Object.keys(CATEGORY_COLORS);
  const addTag = () => { if (tagInput.trim() && !form.tags.includes(tagInput.trim())) { setForm({ ...form, tags: [...form.tags, tagInput.trim()] }); setTagInput(''); } };
  const removeTag = (t) => setForm({ ...form, tags: form.tags.filter(x => x !== t) });
  const addIng = () => { if (!newIng.name.trim()) return; setRecipeIngs([...recipeIngs, { ...newIng, kroger: newIng.kroger || newIng.name.toLowerCase() }]); setNewIng({ name: '', qty: '', cat: 'Produce', kroger: '', staple: false, combine: false }); };
  const removeIng = (i) => setRecipeIngs(recipeIngs.filter((_, idx) => idx !== i));
  const handleSave = () => { if (!form.name.trim()) return; onSave({ ...form, name: form.name.trim() }, recipeIngs); };
  return (<motion.div style={styles.modalBg} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
    <motion.div style={styles.modal} initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} onClick={e => e.stopPropagation()}>
      <div style={styles.modalHead}>
        <h2 style={styles.modalTitle}>{isNew ? 'New recipe' : 'Edit recipe'}</h2>
        <button onClick={onClose} style={styles.iconBtn}><X size={18} strokeWidth={1.6} /></button>
      </div>
      <div style={styles.modalBody}>
        <Field label="Name"><input style={styles.input} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="What's it called?" /></Field>
        <Field label="Category"><select style={styles.select} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{cats.map(c => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Tags">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {form.tags.map(t => <span key={t} style={styles.tagPill}>{t}<button onClick={() => removeTag(t)} style={styles.tagPillX}><X size={11} strokeWidth={2} /></button></span>)}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input style={{ ...styles.input, flex: 1 }} value={tagInput} onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())} placeholder="Add a tag…" />
            <button onClick={addTag} style={styles.toolBtn}><Plus size={14} strokeWidth={1.6} /></button>
          </div>
        </Field>
        <Field label="Don't repeat for">
          <div style={{ display: 'flex', gap: 6 }}>
            {[1, 2, 3, 4].map(w => <button key={w} onClick={() => setForm({ ...form, repeatWeeks: w })} style={{ ...styles.chip, ...(form.repeatWeeks === w ? styles.chipActive : {}) }}>{w} {w === 1 ? 'week' : 'weeks'}</button>)}
          </div>
        </Field>
        <Field label="Notes (optional)"><textarea style={styles.textarea} value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} /></Field>
        <div style={styles.divider} />
        <div style={styles.filterLabel}>Ingredients</div>
        <div style={{ marginTop: 8 }}>
          {recipeIngs.map((ing, i) => <div key={i} style={styles.ingEditRow}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={styles.shopName}>{ing.name} <span style={{ color: '#9b8c7a', fontWeight: 400 }}>· {ing.qty}</span></div>
              <div style={styles.shopMeta}>{ing.cat}{ing.staple && ' · staple'}{ing.combine && ' · combinable'}</div>
            </div>
            <button onClick={() => removeIng(i)} style={styles.iconBtn}><X size={14} strokeWidth={1.6} /></button>
          </div>)}
        </div>
        <div style={styles.ingAddCard}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8, marginBottom: 8 }}>
            <input style={styles.input} placeholder="Ingredient" value={newIng.name} onChange={e => setNewIng({ ...newIng, name: e.target.value })} />
            <input style={styles.input} placeholder="Qty" value={newIng.qty} onChange={e => setNewIng({ ...newIng, qty: e.target.value })} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <select style={styles.select} value={newIng.cat} onChange={e => setNewIng({ ...newIng, cat: e.target.value })}>{groceryCats.map(c => <option key={c}>{c}</option>)}</select>
            <input style={styles.input} placeholder="Kroger search term" value={newIng.kroger} onChange={e => setNewIng({ ...newIng, kroger: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, fontSize: 13, color: '#5a4530' }}>
            <label style={styles.checkLine}><input type="checkbox" checked={newIng.staple} onChange={e => setNewIng({ ...newIng, staple: e.target.checked })} /> Pantry staple</label>
            <label style={styles.checkLine}><input type="checkbox" checked={newIng.combine} onChange={e => setNewIng({ ...newIng, combine: e.target.checked })} /> Combine with duplicates</label>
          </div>
          <button onClick={addIng} style={styles.toolBtn}><Plus size={14} strokeWidth={1.6} /> Add ingredient</button>
        </div>
      </div>
      <div style={styles.modalFoot}>
        {!isNew && <button onClick={onDelete} style={styles.deleteBtn}><Trash2 size={14} strokeWidth={1.6} /> Delete</button>}
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={styles.toolBtn}>Cancel</button>
        <button onClick={handleSave} style={styles.toolBtnPrimary} disabled={!form.name.trim()}>Save</button>
      </div>
    </motion.div>
  </motion.div>);
}

function Field({ label, children }) { return (<div style={{ marginBottom: 14 }}><div style={styles.filterLabel}>{label}</div>{children}</div>); }
