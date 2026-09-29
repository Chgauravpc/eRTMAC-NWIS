import { supabase } from '../supabase';

export async function getReviewQueue() {
  const { data, error } = await supabase.from('v_review_queue').select('*');
  if (error) throw error;
  return data || [];
}

export async function getFieldsForDocument(docId) {
  const { data, error } = await supabase.from('extracted_fields')
    .select('*, documents(title, wellbore_id)')
    .eq('document_id', docId)
    .eq('review_status', 'pending')
    .order('page');
  if (error) throw error;
  return data || [];
}

export async function getPageImageUrl(docId, page) {
  const path = `page-images/${docId}/${page}.png`;
  const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, 3600);
  if (error) return null;
  return data.signedUrl;
}

export async function reviewField(fieldId, action, value = null) {
  const { error } = await supabase.rpc('review_field', {
    p_field: fieldId,
    p_action: action,
    p_value: value
  });
  if (error) throw error;
}
